from urllib.parse import quote

import httpx

from . import ClientSession


class OpenAIProvider:
    name = "openai"

    def __init__(self, api_key: str, model: str, voice: str, client: httpx.AsyncClient):
        self._api_key, self._model, self._voice, self._client = api_key, model, voice, client

    async def create_client_session(self, *, instructions: str) -> ClientSession:
        res = await self._client.post(
            "https://api.openai.com/v1/realtime/client_secrets",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json={
                # The token only has to start the call; a short expiry limits reuse by a tampered client.
                "expires_after": {"anchor": "created_at", "seconds": 60},
                "session": {
                    "type": "realtime",
                    "model": self._model,
                    "instructions": instructions,
                    "audio": {
                        "input": {"transcription": {"model": "gpt-4o-mini-transcribe"}},
                        "output": {"voice": self._voice},
                    },
                    "tools": [
                        {
                            "type": "function",
                            "name": "end_session",
                            "description": "Call after the closing thank-you to end the feedback session.",
                            "parameters": {
                                "type": "object",
                                "properties": {},
                                "additionalProperties": False,
                            },
                        }
                    ],
                },
            },
        )
        if res.status_code >= 400:
            raise RuntimeError(f"OpenAI client_secrets failed: {res.status_code} {res.text}")
        body = res.json()
        return ClientSession(
            provider="openai",
            model=self._model,
            client_secret=body["value"],
            expires_at=body["expires_at"],
            connect_url=f"https://api.openai.com/v1/realtime/calls?model={quote(self._model, safe='')}",
            instructions=instructions,
        )
