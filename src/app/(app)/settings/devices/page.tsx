"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shell/PageHeader";
import { api, call } from "@/lib/api/client";
import { useNow } from "@/lib/hooks";
import type { Device } from "@/lib/api/types";
import { errorMessage } from "@/lib/errors";
import { useAuthStore } from "@/stores/auth";

const DEVICES_KEY = ["devices"] as const;

function lastActive(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 2) return "Active now";
  if (min < 60) return `Active ${min} minutes ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Active ${h} hour${h === 1 ? "" : "s"} ago`;
  return `Last active ${new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

export default function DevicesPage() {
  const queryClient = useQueryClient();
  // null while prerendering, so the HTML never depends on the clock.
  const now = useNow();

  const devices = useQuery({
    queryKey: DEVICES_KEY,
    queryFn: () => call(() => api.GET("/devices")),
    refetchInterval: 30_000,
  });

  const revoke = useMutation({
    mutationFn: async (device: Device) => {
      if (device.current) {
        await call(() => api.POST("/auth/sign-out"));
      } else {
        await call(() => api.DELETE("/devices/{deviceId}", { params: { path: { deviceId: device.id } } }));
      }
      return device;
    },
    onSuccess: (device) => {
      if (device.current) {
        queryClient.clear();
        useAuthStore.getState().clear(null);
        return;
      }
      queryClient.setQueryData<Device[]>(DEVICES_KEY, (list) => list?.filter((d) => d.id !== device.id));
    },
  });

  const list = [...(devices.data ?? [])].sort(
    (a, b) => Number(b.current) - Number(a.current) || a.type.localeCompare(b.type),
  );

  return (
    <>
      <PageHeader title="Linked devices" subtitle="Devices signed in to your account." />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-8">
          {devices.isPending && <p className="text-sm text-muted">Loading devices…</p>}
          {devices.isError && (
            <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
              {errorMessage(devices.error)}
            </p>
          )}
          {revoke.isError && (
            <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
              {errorMessage(revoke.error)}
            </p>
          )}

          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {list.map((d) => (
              <li key={d.id} className="flex items-center gap-4 px-4 py-4" data-testid="device-row">
                <span
                  aria-hidden
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-xl"
                >
                  {d.type === "android" ? "📱" : "💻"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {d.name}
                    {d.current && (
                      <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                        This browser
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted">
                    {d.type === "android" ? "Android" : "Web"}
                    {now !== null && ` · ${d.current ? "Active now" : lastActive(d.lastActiveAt, now)}`}
                  </p>
                </div>
                <button
                  onClick={() => revoke.mutate(d)}
                  disabled={revoke.isPending}
                  className="rounded-xl px-3 py-2 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
                >
                  Sign out
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
