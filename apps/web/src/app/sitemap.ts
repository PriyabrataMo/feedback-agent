import type { MetadataRoute } from "next";
import { SITE_UPDATED, SITE_URL } from "@/lib/site";

// Only public, indexable pages. /demo and /dashboard are hidden in production.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(SITE_UPDATED),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
