import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SessionPlayback } from "@/components/session-playback";
import { normalizeSteps } from "@/components/session-playback/timeline";
import { eventsUrl, getSession, mediaUrl } from "@/lib/api";

async function SessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();
  const steps = normalizeSteps(session.reproSteps);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{session.id}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">Page:</span> {session.url}
          </p>
          <p>
            <span className="text-muted-foreground">Status:</span> {session.status} ·{" "}
            <span className="text-muted-foreground">Agent:</span> {session.realtimeProvider}
          </p>
          <p>
            <span className="text-muted-foreground">Started:</span> {new Date(session.startedAt).toLocaleString()}
            {session.endedAt && <> · ended {new Date(session.endedAt).toLocaleString()}</>}
          </p>
          <p>
            <span className="text-muted-foreground">Stored:</span> {session.mediaChunks} media chunks, {session.replaySegments}{" "}
            replay segments
          </p>
          <p className="truncate text-muted-foreground">{session.userAgent}</p>
        </CardContent>
      </Card>

      {(session.summary || session.ticketUrl || session.ticketStatus || steps.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Ticket
              {session.ticketStatus && <Badge variant="secondary">{session.ticketStatus}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {session.summary && <p>{session.summary}</p>}
            {session.ticketUrl && (
              <p>
                <a className="underline" href={session.ticketUrl} target="_blank" rel="noreferrer noopener">
                  {session.ticketUrl}
                </a>
              </p>
            )}
            {steps.length > 0 && (
              <div>
                <p className="mb-1 font-medium">Steps to reproduce</p>
                <ol className="list-decimal space-y-1 pl-5">
                  {steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <SessionPlayback
        key={session.id}
        sessionId={session.id}
        startedAt={session.startedAt}
        eventsUrl={eventsUrl(session.id)}
        mediaUrl={session.mediaChunks > 0 ? mediaUrl(session.id) : null}
        transcript={session.transcript}
        context={session.context}
      />

      <Card>
        <CardHeader>
          <CardTitle>Model usage (tokens)</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto rounded bg-muted p-3 text-xs">
            {JSON.stringify(session.usage, null, 2) ?? "none"}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Page context</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto rounded bg-muted p-3 text-xs">
            {JSON.stringify(session.context, null, 2) ?? "none"}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6 md:p-10">
      <Link className="text-sm underline" href="/dashboard">
        ← All sessions
      </Link>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <SessionDetail params={params} />
      </Suspense>
    </main>
  );
}
