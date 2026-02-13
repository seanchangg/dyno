"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useVaultFiles } from "@/hooks/useVaultFiles";
import { useStorageFiles, type BucketName } from "@/hooks/useStorageFiles";
import DropZone from "@/components/vault/DropZone";
import FileTable from "@/components/vault/FileTable";
import FilePreview from "@/components/vault/FilePreview";

const BUCKETS: { key: BucketName; label: string; description: string; emptyMessage: string }[] = [
  {
    key: "workspace",
    label: "Workspace",
    description: "Files your agent creates and works with",
    emptyMessage: "No workspace files yet — your agent will create files here as it works",
  },
  {
    key: "scripts",
    label: "Scripts",
    description: "Reusable code your agent has saved",
    emptyMessage: "No scripts yet — your agent saves reusable code here",
  },
  {
    key: "widgets",
    label: "Widgets",
    description: "Dashboard widget source files",
    emptyMessage: "No widget files yet",
  },
  {
    key: "uploads",
    label: "Uploads",
    description: "Files you've uploaded for your agent",
    emptyMessage: "No files uploaded yet — drag and drop files above",
  },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function VaultPage() {
  const { user } = useAuth();
  const [activeBucket, setActiveBucket] = useState<BucketName>("workspace");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Uploads bucket uses dedicated hook with upload/delete support
  const vaultFiles = useVaultFiles(user?.id);

  // Other buckets use read-only storage hook
  const storageFiles = useStorageFiles(user?.id, activeBucket);

  const isUploads = activeBucket === "uploads";
  const files = isUploads ? vaultFiles.files : storageFiles.files;
  const loading = isUploads ? vaultFiles.loading : storageFiles.loading;
  const totalSize = isUploads ? vaultFiles.totalSize : storageFiles.totalSize;

  const activeBucketConfig = BUCKETS.find((b) => b.key === activeBucket)!;

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter((f) => f.filename.toLowerCase().includes(q));
  }, [files, search]);

  const selectedFileData = useMemo(
    () => files.find((f) => f.filename === selectedFile) || null,
    [files, selectedFile],
  );

  const handleDelete = async (filename: string) => {
    await vaultFiles.deleteFile(filename);
    if (selectedFile === filename) {
      setSelectedFile(null);
    }
  };

  const handleBucketChange = (bucket: BucketName) => {
    setActiveBucket(bucket);
    setSelectedFile(null);
    setSearch("");
  };

  return (
    <div className="max-w-6xl">
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-xl font-bold text-highlight">Files</h1>
        {!loading && files.length > 0 && (
          <p className="text-xs text-text/40">
            {files.length} file{files.length !== 1 ? "s" : ""} — {formatSize(totalSize)}
          </p>
        )}
      </div>

      {/* Bucket tabs */}
      <div className="flex gap-2 mb-2">
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            onClick={() => handleBucketChange(b.key)}
            className={`text-sm px-3 py-1 transition-colors ${
              activeBucket === b.key
                ? "bg-primary text-highlight"
                : "text-text/50 hover:text-highlight"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-text/40 mb-6">{activeBucketConfig.description}</p>

      {isUploads && (
        <div className="mb-6">
          <DropZone onUpload={vaultFiles.uploadFile} disabled={loading} />
        </div>
      )}

      {files.length > 5 && (
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files..."
            className="w-full bg-background border border-primary/30 px-3 py-2 text-sm text-text placeholder:text-text/40 focus:outline-none focus:border-highlight transition-colors"
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-text/40 py-8 text-center">Loading...</p>
      ) : (
        <div className={`flex gap-6 ${selectedFileData ? "" : ""}`}>
          <div className={selectedFileData ? "flex-1 min-w-0" : "w-full"}>
            <FileTable
              files={filteredFiles}
              selectedFile={selectedFile}
              onSelect={setSelectedFile}
              onDelete={isUploads ? handleDelete : undefined}
              emptyMessage={activeBucketConfig.emptyMessage}
            />
          </div>

          {selectedFileData && user && (
            <div className="w-[380px] shrink-0 max-h-[600px]">
              <FilePreview
                file={selectedFileData}
                userId={user.id}
                onClose={() => setSelectedFile(null)}
                bucket={activeBucket}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
