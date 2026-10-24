"""
Ticket worker: session ended -> summarize -> render -> create ticket through the project's TicketSink.

Queue seam: `TicketWorker.enqueue(session_id)` is the producer and `TicketWorker.process(session_id)`
is the whole job. The in-process asyncio queue below is the dev/MVP transport; to move to arq / SQS /
BullMQ-style infra, have the API call that queue's enqueue instead and run `process` in a consumer.
`process` is safe to run any number of times for the same session (claim + idempotent sink), which is
what at-least-once queues require.
"""

import asyncio
import logging

import httpx

from ..projects import ProjectRegistry
from ..sessions import SessionStore
from ..tickets import SinkRuntime, TicketDraft, TicketError, build_sink
from ..tickets.sanitize import clean_line
from .render import build_draft
from .settings import TicketSettings
from .summarize import build_facts, summarize

log = logging.getLogger("feedback_api.worker")

DRAIN_TIMEOUT = 10.0


class TicketWorker:
    def __init__(
        self,
        *,
        store: SessionStore,
        projects: ProjectRegistry,
        settings: TicketSettings,
        client: httpx.AsyncClient,
    ):
        self._store, self._projects, self._settings, self._client = (
            store,
            projects,
            settings,
            client,
        )
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._tasks: list[asyncio.Task] = []
        self._runtime = SinkRuntime(
            client=client,
            env=settings.env,
            attempts=settings.retry_attempts,
            base_delay=settings.retry_base_delay,
            **({"sleep": settings.sleep} if settings.sleep else {}),
        )

    # --- producer ------------------------------------------------------------------------------

    def enqueue(self, session_id: str) -> None:
        """Called from POST /end. Never raises: ticket problems must not affect the SDK response."""
        try:
            if self._store.mark_ticket_pending(session_id):
                self._queue.put_nowait(session_id)
        except Exception:
            log.exception("could not enqueue ticket job for %s", session_id)

    # --- lifecycle -----------------------------------------------------------------------------

    async def start(self) -> None:
        for session_id in self._store.requeue_interrupted_tickets():  # crash/restart recovery
            self._queue.put_nowait(session_id)
        self._tasks = [
            asyncio.create_task(self._run(), name=f"ticket-worker-{i}")
            for i in range(max(self._settings.workers, 1))
        ]

    async def stop(self) -> None:
        try:
            await asyncio.wait_for(self._queue.join(), DRAIN_TIMEOUT)
        except TimeoutError:
            log.warning("ticket worker stopping with unfinished jobs; they resume on next start")
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []

    async def _run(self) -> None:
        while True:
            session_id = await self._queue.get()
            try:
                await self.process(session_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("ticket job crashed for %s", session_id)
            finally:
                self._queue.task_done()

    # --- the job -------------------------------------------------------------------------------

    async def process(self, session_id: str) -> None:
        store = self._store
        session = store.get(session_id)
        if session is None or session.status != "ended":
            return
        if not store.claim_ticket(session_id):
            return  # already created / running elsewhere: this is what makes retries idempotent

        try:
            project = self._projects.by_id(session.project_id)
            if project is None or project.ticket_sink is None:
                store.set_ticket(session_id, ticket_status="skipped")
                return

            # Build the sink first so a missing key fails fast, before we spend an LLM call.
            sink = build_sink(project.ticket_sink, self._runtime)

            if session.ticket_draft:  # summarised by an earlier attempt that failed at the sink
                draft = TicketDraft.from_dict(session.ticket_draft)
            else:
                facts = build_facts(session)
                summary = await summarize(facts, self._settings, self._client)
                draft = build_draft(
                    project_id=project.id,
                    session_id=session_id,
                    facts=facts,
                    summary=summary,
                    settings=self._settings,
                )
                store.set_ticket(
                    session_id,
                    summary=draft.summary,
                    repro_steps=draft.repro_steps,
                    ticket_draft=draft.to_dict(),
                )

            result = await sink.create(draft)
            store.set_ticket(
                session_id,
                ticket_status="created",
                ticket_url=result.url,
                ticket_external_id=result.external_id,
                ticket_error=None,
            )
        except asyncio.CancelledError:
            raise  # stays 'creating'; requeued on next start (sink create is idempotent)
        except TicketError as exc:
            log.warning("ticket for %s failed: %s", session_id, exc.message)
            store.set_ticket(
                session_id, ticket_status="failed", ticket_error=clean_line(exc.message, 300)
            )
        except Exception as exc:
            log.exception("ticket for %s failed unexpectedly", session_id)
            store.set_ticket(
                session_id,
                ticket_status="failed",
                ticket_error=f"internal error: {type(exc).__name__}",
            )
