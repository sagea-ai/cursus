"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { FiEdit2 } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProfileInfo } from "@/lib/profile";

export function EditProfileDialog({ user }: { user: ProfileInfo }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [bio, setBio] = React.useState(user.bio);
  const [location, setLocation] = React.useState(user.location);
  const [website, setWebsite] = React.useState(user.website);
  const [twitter, setTwitter] = React.useState(user.twitter);
  const [github, setGithub] = React.useState(user.github);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bio, location, website, twitter, github }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not save profile");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <FiEdit2 /> Edit profile
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-name">Name</Label>
            <Input id="profile-name" value={user.name || user.email} disabled />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={user.email} disabled />
            <p className="text-xs text-muted-foreground">
              Name and email are set at invite time and cannot be changed here —
              ask a super admin.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-bio">Bio</Label>
            <textarea
              id="profile-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="What do you train?"
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-location">Location</Label>
              <Input
                id="profile-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={128}
                placeholder="Kathmandu"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-website">Website</Label>
              <Input
                id="profile-website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                maxLength={256}
                placeholder="https://…"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-twitter">Twitter</Label>
              <Input
                id="profile-twitter"
                value={twitter}
                onChange={(e) => setTwitter(e.target.value)}
                maxLength={64}
                placeholder="handle"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-github">GitHub</Label>
              <Input
                id="profile-github"
                value={github}
                onChange={(e) => setGithub(e.target.value)}
                maxLength={64}
                placeholder="octocat"
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-warning">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
