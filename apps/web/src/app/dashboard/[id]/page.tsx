import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession, mediaUrl } from "@/lib/api";

async function SessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();

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

      {session.mediaChunks > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recording</CardTitle>
          </CardHeader>
          <CardContent>
            <video controls className="w-full rounded" src={mediaUrl(session.id)} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {session.transcript.length === 0 && <p className="text-muted-foreground">No transcript captured.</p>}
          {session.transcript.map((t, i) => (
            <p key={i}>
              <strong>{t.role === "agent" ? "Agent" : "User"}</strong>{" "}
              <span className="text-muted-foreground">{Math.round(t.at / 1000)}s</span> {t.text}
            </p>
          ))}
        </CardContent>
      </Card>

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
    <main className="mx-auto max-w-4xl space-y-4 p-10">
      <Link className="text-sm underline" href="/dashboard">
        ← All sessions
      </Link>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <SessionDetail params={params} />
      </Suspense>
    </main>
  );
}
