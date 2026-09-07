"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  DatabaseBackup,
  Play,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { BackupItem, BackupSettings } from "./types";
import {
  WEEKDAYS,
  fetchBackups,
  formatBackupDate,
  formatBackupSize,
  getStatusClass,
  removeBackup,
  restoreBackup,
  saveBackupSettings,
  startBackup,
} from "./utils";

export default function BackupsPage() {
  const queryClient = useQueryClient();
  const restoreInput = useRef<HTMLInputElement | null>(null);
  const [settings, setSettings] = useState<BackupSettings | null>(null);

  const backups = useQuery({
    queryKey: ["backups"],
    queryFn: fetchBackups,
    refetchInterval: (query) =>
      query.state.data?.backups.some(
        (backup) => backup.status === "queued" || backup.status === "running",
      )
        ? 5000
        : false,
  });

  useEffect(() => {
    if (backups.data?.settings) {
      setSettings(backups.data.settings);
    }
  }, [backups.data?.settings]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      if (!settings) return;
      await saveBackupSettings(settings);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backups"] }),
  });

  const runBackup = useMutation({
    mutationFn: startBackup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backups"] }),
  });

  const deleteBackup = useMutation({
    mutationFn: removeBackup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backups"] }),
  });

  const restore = useMutation({
    mutationFn: restoreBackup,
    onSuccess: () => window.location.assign("/login"),
  });

  const error =
    backups.error ||
    saveSettings.error ||
    runBackup.error ||
    deleteBackup.error ||
    restore.error;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium text-neutral-900">
            Database Backups
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Manage database backup settings and restore previously exported
            backups. Stored backup files are disabled in this R2-free
            deployment.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Input
            ref={restoreInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";

              if (
                !file ||
                !window.confirm(
                  "Restore this backup? This replaces all current database records and may sign you out.",
                )
              ) {
                return;
              }

              restore.mutate(file);
            }}
          />

          <Button
            type="button"
            variant="outline"
            disabled={restore.isPending}
            onClick={() => restoreInput.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {restore.isPending ? "Restoring..." : "Restore"}
          </Button>

          <Button
            onClick={() => runBackup.mutate()}
            disabled={runBackup.isPending}
          >
            <Play className="h-4 w-4" />
            {runBackup.isPending ? "Starting..." : "Back up now"}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error instanceof Error ? error.message : "Backup operation failed"}
        </p>
      )}

      <Card className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
        <CardHeader className="py-0">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <CardTitle className="text-amber-950">
                Stored backup files disabled
              </CardTitle>
              <CardDescription className="mt-1 text-amber-800">
                This deployment does not use Cloudflare R2, so backup files are
                not stored remotely. Automatic stored backups are disabled.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card className="rounded-3xl border-0 bg-white p-6">
        <CardHeader className="py-0">
          <CardTitle>Automatic backup</CardTitle>
          <CardDescription>
            Automatic stored backups are disabled in R2-free mode.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          {settings && (
            <>
              <div className="flex items-center gap-3 text-sm font-medium">
                <Switch
                  checked={false}
                  disabled
                  aria-label="Automatic backups disabled"
                />
                <span>Automatic backups disabled</span>
              </div>

              <p className="text-sm text-neutral-500">
                Backup scheduling is kept in the interface for compatibility,
                but no backup files will be written to R2.
              </p>

              <Button
                onClick={() => saveSettings.mutate()}
                disabled={saveSettings.isPending}
              >
                <Save className="h-4 w-4" />
                {saveSettings.isPending ? "Saving..." : "Save settings"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <section className="overflow-hidden rounded-3xl bg-white">
        <div className="flex items-center gap-3 border-b border-neutral-100 px-4 py-4">
          <DatabaseBackup className="h-5 w-5 text-neutral-500" />
          <h2 className="font-semibold text-neutral-900">Backup history</h2>
        </div>

        <div className="grid grid-cols-[1fr_110px_110px_170px_80px] gap-4 border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          <span>File</span>
          <span>Status</span>
          <span>Size</span>
          <span>Created</span>
          <span>Actions</span>
        </div>

        {backups.isLoading && <SkeletonRows count={5} />}

        {!backups.isLoading &&
          (backups.data?.backups ?? []).length === 0 && (
            <p className="px-4 py-6 text-sm text-neutral-500">
              No backups yet.
            </p>
          )}

        {(backups.data?.backups ?? []).map((backup: BackupItem) => (
          <div
            key={backup.id}
            className="grid grid-cols-[1fr_110px_110px_170px_80px] items-center gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutral-900">
                {backup.filename ?? backup.id}
              </p>

              <p className="truncate text-xs text-neutral-500">
                {backup.trigger === "manual" ? "Manual" : "Scheduled"}
                {backup.error ? `: ${backup.error}` : ""}
              </p>
            </div>

            <Badge
              variant="outline"
              className={getStatusClass(backup.status)}
            >
              {backup.status}
            </Badge>

            <span className="text-sm text-neutral-600">
              {formatBackupSize(backup.size)}
            </span>

            <span className="text-sm text-neutral-600">
              {formatBackupDate(backup.createdAt)}
            </span>

            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                title="Download backup"
                disabled
                aria-label="Download backup disabled"
              >
                <span className="text-xs text-neutral-400">N/A</span>
              </Button>

              <Button
                size="sm"
                variant="ghost"
                title="Delete backup"
                disabled={
                  deleteBackup.isPending ||
                  backup.status === "queued" ||
                  backup.status === "running"
                }
                onClick={() => deleteBackup.mutate(backup.id)}
              >
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
