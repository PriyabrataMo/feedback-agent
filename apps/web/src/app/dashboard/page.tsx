import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listSessions } from "@/lib/api";

export const metadata = {
  title: "Sessions",
  robots: { index: false, follow: false, noarchive: true },
};

async function SessionsTable() {
  const sessions = await listSessions();
  if (sessions.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        No sessions yet. Try the demo app at /demo.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Session</TableHead>
          <TableHead>Page</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead>Started</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((s) => (
          <TableRow key={s.id}>
            <TableCell>
              <Link className="underline" href={`/dashboard/${s.id}`}>
                {s.id}
              </Link>
            </TableCell>
            <TableCell className="max-w-xs truncate">{s.url}</TableCell>
            <TableCell>
              <Badge variant={s.status === "ended" ? "default" : "secondary"}>
                {s.status}
              </Badge>
            </TableCell>
            <TableCell>{s.realtimeProvider}</TableCell>
            <TableCell>{new Date(s.startedAt).toLocaleString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-5xl p-10">
      <Card>
        <CardHeader>
          <CardTitle>Showbug sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense
            fallback={
              <p className="p-6 text-sm text-muted-foreground">Loading…</p>
            }
          >
            <SessionsTable />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
