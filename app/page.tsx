import { redirect } from "next/navigation";

import { requirePageSession } from "@/lib/page-auth";

// Landing: logged in → your projects; otherwise requirePageSession sends you
// to /login (there is no public signup in v1).
export default async function Home() {
  const { org } = await requirePageSession();
  redirect(`/${org.slug}/projects`);
}
