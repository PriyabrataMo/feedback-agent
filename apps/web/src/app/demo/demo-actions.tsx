"use client";

import { Button } from "@/components/ui/button";

export function DemoActions() {
  return (
    <div className="flex gap-3">
      <Button
        variant="outline"
        onClick={() => {
          console.error("Invoice export failed: TypeError: Cannot read properties of undefined (reading 'lineItems')");
        }}
      >
        Export invoice (logs an error)
      </Button>
      <Button variant="outline" onClick={() => void fetch("/api/does-not-exist")}>
        Load usage report (404)
      </Button>
    </div>
  );
}
