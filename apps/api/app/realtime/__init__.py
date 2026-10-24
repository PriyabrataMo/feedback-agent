"""
Server half of the realtime voice agent. The browser connects straight to the model provider with
a short-lived client secret minted here, so the real API key never leaves the server and audio
never proxies through us. The browser half lives in packages/sdk/src/realtime.
Swapping OpenAI <-> Gemini means adding a provider here and a matching one in the SDK.
"""

from dataclasses import asdict, dataclass
from typing import Literal, Protocol

from pydantic.alias_generators import to_camel

AGENT_INSTRUCTIONS = """You are a friendly product-feedback agent embedded in a web app. The user is sharing their screen and microphone with you so they can report a problem.

Open by saying: "Hello! What problem are you running into?"
Then listen. You receive periodic screenshots of the user's current tab; use them to ground your questions, but never read out sensitive data you can see on screen.

Ask at most 3 short follow-up questions, one at a time, only for what is still missing:
- what they expected to happen vs. what actually happened
- whether it happens every time or only sometimes
- what they clicked or typed just before it went wrong

Keep every turn to one or two sentences. Do not offer fixes or promise timelines; you only collect the report.
When you have enough, or the user says they are done, say "Thank you, I've passed this to the team." and immediately call the end_session tool."""


@dataclass
class ClientSession:
    provider: Literal["openai", "mock"]
    model: str
    client_secret: str
    expires_at: int
    # Where the browser sends its WebRTC SDP offer.
    connect_url: str
    instructions: str

    def to_api(self) -> dict:
        return {to_camel(k): v for k, v in asdict(self).items()}


class RealtimeProvider(Protocol):
    name: str

    async def create_client_session(self, *, instructions: str) -> ClientSession: ...
