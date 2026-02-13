"use client";

import { useState, useEffect } from "react";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import {
  generateEncryptionKey,
  encryptApiKey,
  exportKey,
  getDecryptedApiKey,
} from "@/lib/crypto";
import type { ChatSettings } from "@/types";
import { DEFAULT_CHAT_SETTINGS } from "@/types";
import { authFetch } from "@/lib/api";

export default function SettingsPage() {
  const { user, profile, signOut } = useAuth();
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [exportedPrivateKey, setExportedPrivateKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [hasEncryptedKey, setHasEncryptedKey] = useState(false);

  // Credential vault state
  const [credentials, setCredentials] = useState<Array<{ credential_name: string; created_at: string; updated_at: string }>>([]);
  const [credName, setCredName] = useState("");
  const [credValue, setCredValue] = useState("");
  const [credStatus, setCredStatus] = useState<string | null>(null);
  const [credLoading, setCredLoading] = useState(false);

  // Chat settings state
  const [chatSettings, setChatSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [chatSettingsSaving, setChatSettingsSaving] = useState(false);
  const [chatSettingsStatus, setChatSettingsStatus] = useState<string | null>(null);

  // Autonomous mode state
  const [autonomousSaving, setAutonomousSaving] = useState(false);
  const [autonomousStatus, setAutonomousStatus] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setUsername(profile.username || "");
      setFullName(profile.full_name || "");
      setHasEncryptedKey(!!profile.encrypted_api_key);
      if (profile.chat_settings) {
        setChatSettings({ ...DEFAULT_CHAT_SETTINGS, ...profile.chat_settings });
      }
    }
  }, [profile]);

  useEffect(() => {
    setHasStoredKey(!!localStorage.getItem("dyno_encryption_key"));
    const stored = localStorage.getItem("dyno_encryption_key");
    if (stored) setPrivateKeyInput(stored);
  }, []);

  const handleSaveApiKey = async () => {
    if (!apiKey.trim() || !user) return;
    try {
      const key = await generateEncryptionKey();
      const ciphertext = await encryptApiKey(apiKey, key);
      const exported = await exportKey(key);

      // Store private key locally
      localStorage.setItem("dyno_encryption_key", exported);
      setHasStoredKey(true);
      setPrivateKeyInput(exported);

      // Store ciphertext in Supabase
      const res = await authFetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          encrypted_api_key: ciphertext,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setKeyStatus(`Failed to store encrypted key: ${data.error}`);
        return;
      }

      setApiKey("");
      setExportedPrivateKey(exported);
      setHasEncryptedKey(true);
      setShowKeyModal(true);
      setKeyStatus("API key encrypted and saved.");
    } catch {
      setKeyStatus("Failed to encrypt API key.");
    }
  };

  const handleSavePrivateKey = () => {
    if (!privateKeyInput.trim()) return;
    localStorage.setItem("dyno_encryption_key", privateKeyInput.trim());
    setHasStoredKey(true);
    setKeyStatus("Private key saved to browser.");
  };

  const handleCopyKey = async () => {
    await navigator.clipboard.writeText(exportedPrivateKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const loadCredentials = async () => {
    if (!user) return;
    try {
      const res = await authFetch(`/api/credentials?userId=${user.id}`);
      const data = await res.json();
      setCredentials(data.credentials ?? []);
    } catch {
      // ignore load errors
    }
  };

  useEffect(() => {
    loadCredentials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleAddCredential = async () => {
    if (!credName.trim() || !credValue.trim() || !user) return;
    const nameUpper = credName.trim().toUpperCase();
    if (!/^[A-Z0-9_]{1,64}$/.test(nameUpper)) {
      setCredStatus("Name must be uppercase letters, numbers, and underscores (max 64 chars).");
      return;
    }
    setCredLoading(true);
    setCredStatus(null);
    try {
      const res = await authFetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, name: nameUpper, value: credValue }),
      });
      if (!res.ok) {
        const data = await res.json();
        setCredStatus(`Failed: ${data.error}`);
      } else {
        setCredName("");
        setCredValue("");
        setCredStatus(`Credential "${nameUpper}" saved.`);
        loadCredentials();
      }
    } catch {
      setCredStatus("Failed to save credential.");
    } finally {
      setCredLoading(false);
    }
  };

  const handleRemoveCredential = async (name: string) => {
    if (!user) return;
    try {
      await authFetch("/api/credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, name }),
      });
      setCredStatus(`Credential "${name}" removed.`);
      loadCredentials();
    } catch {
      setCredStatus("Failed to remove credential.");
    }
  };

  const handleSaveChatSettings = async () => {
    if (!user) return;
    setChatSettingsSaving(true);
    setChatSettingsStatus(null);
    try {
      const res = await authFetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          chat_settings: chatSettings,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setChatSettingsStatus(`Failed to save: ${data.error}`);
      } else {
        setChatSettingsStatus("Chat settings saved.");
      }
    } catch {
      setChatSettingsStatus("Failed to save chat settings.");
    } finally {
      setChatSettingsSaving(false);
    }
  };

  const handleSaveAutonomous = async () => {
    if (!user) return;
    setAutonomousSaving(true);
    setAutonomousStatus(null);
    try {
      // If enabling, decrypt the API key to send to the server
      let decryptedApiKey: string | null = null;
      if (chatSettings.autonomousEnabled) {
        decryptedApiKey = await getDecryptedApiKey(profile?.encrypted_api_key);
        if (!decryptedApiKey) {
          setAutonomousStatus(
            "Cannot enable autonomous mode: no API key found. Save your API key first."
          );
          setAutonomousSaving(false);
          return;
        }
      }

      // Save settings to profile
      const profileRes = await authFetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          chat_settings: chatSettings,
        }),
      });
      if (!profileRes.ok) {
        const data = await profileRes.json();
        setAutonomousStatus(`Failed to save: ${data.error}`);
        return;
      }

      // Start or stop heartbeat via gateway
      const action = chatSettings.autonomousEnabled ? "start" : "stop";
      const hbPayload: Record<string, unknown> = {
        action,
        userId: user.id,
        config: {
          heartbeatIntervalMinutes: chatSettings.heartbeatIntervalMinutes,
          dailyBudgetCapUsd: chatSettings.dailyBudgetCapUsd,
          triageModel: chatSettings.triageModel,
          escalationModel: chatSettings.escalationModel,
        },
      };
      // Include API key only when enabling — server stores it for autonomous access
      if (action === "start" && decryptedApiKey) {
        hbPayload.apiKey = decryptedApiKey;
      }

      const hbRes = await authFetch("/api/heartbeat-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hbPayload),
      });
      const hbData = await hbRes.json();
      if (!hbRes.ok) {
        setAutonomousStatus(`Saved settings, but gateway error: ${hbData.error}`);
      } else {
        setAutonomousStatus(
          chatSettings.autonomousEnabled
            ? "Autonomous mode enabled. Heartbeat started."
            : "Autonomous mode disabled. Heartbeat stopped. Server-side API key removed."
        );
      }
    } catch {
      setAutonomousStatus("Failed to save autonomous settings.");
    } finally {
      setAutonomousSaving(false);
    }
  };

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-bold text-highlight mb-6">Settings</h1>

      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-text/70 mb-4">Profile</h2>
        <div className="flex flex-col gap-3">
          <Input
            id="settings-username"
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Input
            id="settings-fullname"
            label="Full Name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <Button variant="secondary" disabled>
            Save Profile
          </Button>
          <p className="text-xs text-text/30">
            Profile updates will be available when Supabase is connected.
          </p>
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-text/70 mb-4">
          API Key Management
        </h2>
        <div className="flex flex-col gap-3">
          {hasEncryptedKey && (
            <div className="text-xs text-secondary bg-primary/10 px-3 py-2">
              Encrypted API key is stored in your account.
            </div>
          )}
          <Input
            id="settings-apikey"
            label={hasEncryptedKey ? "Replace API Key" : "API Key"}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
          <Button onClick={handleSaveApiKey} disabled={!apiKey.trim()}>
            Encrypt & Save
          </Button>

          <div className="border-t border-primary/20 pt-3 mt-1">
            <label
              htmlFor="settings-privatekey"
              className="text-sm text-text/70 block mb-1.5"
            >
              Private Decryption Key
            </label>
            <div className="flex gap-2">
              <input
                id="settings-privatekey"
                type="password"
                value={privateKeyInput}
                onChange={(e) => setPrivateKeyInput(e.target.value)}
                placeholder="Paste your private key here"
                className="flex-1 bg-background border border-primary/30 px-3 py-2 text-sm text-text placeholder:text-text/40 focus:outline-none focus:border-highlight transition-colors font-mono"
              />
              <Button
                variant="secondary"
                onClick={handleSavePrivateKey}
                disabled={!privateKeyInput.trim()}
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-text/30 mt-1.5">
              {hasStoredKey
                ? "Private key is stored in your browser."
                : "No private key in browser. Paste it here to enable decryption."}
            </p>
          </div>

          {keyStatus && (
            <p className="text-xs text-highlight">{keyStatus}</p>
          )}
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-text/70 mb-4">
          Credential Vault
        </h2>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-text/30">
            Store third-party API keys and tokens. Your agent can access these at runtime via the get_credential tool.
          </p>

          {credentials.length > 0 && (
            <div className="flex flex-col gap-1">
              {credentials.map((cred) => (
                <div
                  key={cred.credential_name}
                  className="flex items-center justify-between bg-background border border-primary/20 px-3 py-2"
                >
                  <span className="text-sm font-mono text-text/80">
                    {cred.credential_name}
                  </span>
                  <button
                    onClick={() => handleRemoveCredential(cred.credential_name)}
                    className="text-xs text-text/40 hover:text-highlight transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-primary/20 pt-3 mt-1">
            <div className="flex flex-col gap-2">
              <Input
                id="cred-name"
                label="Credential Name"
                value={credName}
                onChange={(e) => setCredName(e.target.value.toUpperCase())}
                placeholder="e.g. GMAIL_API_KEY"
              />
              <Input
                id="cred-value"
                label="Value"
                type="password"
                value={credValue}
                onChange={(e) => setCredValue(e.target.value)}
                placeholder="Your API key or token"
              />
              <Button
                onClick={handleAddCredential}
                disabled={!credName.trim() || !credValue.trim() || credLoading}
              >
                {credLoading ? "Saving..." : "Add Credential"}
              </Button>
            </div>
          </div>

          {credStatus && (
            <p className="text-xs text-highlight">{credStatus}</p>
          )}
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-text/70 mb-4">
          Chat Parameters
        </h2>
        <div className="flex flex-col gap-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm text-text/70">
                History messages sent
              </label>
              <span className="text-sm font-mono text-highlight">
                {chatSettings.maxHistoryMessages}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={chatSettings.maxHistoryMessages}
              onChange={(e) =>
                setChatSettings((s) => ({
                  ...s,
                  maxHistoryMessages: Number(e.target.value),
                }))
              }
              className="w-full accent-primary"
            />
            <p className="text-xs text-text/30 mt-1">
              Number of prior messages included as context with each chat request (0–100).
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm text-text/70">
                Max stored messages
              </label>
              <span className="text-sm font-mono text-highlight">
                {chatSettings.maxStoredMessages}
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={500}
              step={10}
              value={chatSettings.maxStoredMessages}
              onChange={(e) =>
                setChatSettings((s) => ({
                  ...s,
                  maxStoredMessages: Number(e.target.value),
                }))
              }
              className="w-full accent-primary"
            />
            <p className="text-xs text-text/30 mt-1">
              How many messages are retained in chat history on disk (50–500).
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-text/70">
                Include system context
              </label>
              <p className="text-xs text-text/30 mt-0.5">
                Send claude.md as the system prompt in chat.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={chatSettings.includeSystemContext}
              onClick={() =>
                setChatSettings((s) => ({
                  ...s,
                  includeSystemContext: !s.includeSystemContext,
                }))
              }
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center border border-primary/30 transition-colors ${
                chatSettings.includeSystemContext
                  ? "bg-primary"
                  : "bg-background"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform bg-text transition-transform ${
                  chatSettings.includeSystemContext
                    ? "translate-x-6"
                    : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-text/70">
                Include tool descriptions
              </label>
              <p className="text-xs text-text/30 mt-0.5">
                Append tool usage instructions to the system prompt. Off by default since chat has no tools.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={chatSettings.includeToolDescriptions}
              onClick={() =>
                setChatSettings((s) => ({
                  ...s,
                  includeToolDescriptions: !s.includeToolDescriptions,
                }))
              }
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center border border-primary/30 transition-colors ${
                chatSettings.includeToolDescriptions
                  ? "bg-primary"
                  : "bg-background"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform bg-text transition-transform ${
                  chatSettings.includeToolDescriptions
                    ? "translate-x-6"
                    : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <Button
            onClick={handleSaveChatSettings}
            disabled={chatSettingsSaving}
          >
            {chatSettingsSaving ? "Saving..." : "Save Chat Settings"}
          </Button>

          {chatSettingsStatus && (
            <p className="text-xs text-highlight">{chatSettingsStatus}</p>
          )}
        </div>
      </Card>

      <Card className={`mb-6 ${chatSettings.autonomousEnabled ? "border border-red-500/40" : ""}`}>
        <h2 className="text-sm font-semibold text-text/70 mb-4">
          Autonomous Mode (Dangerous)
        </h2>
        <div className="flex flex-col gap-5">
          {chatSettings.autonomousEnabled && (
            <div className="flex flex-col gap-2">
              <div className="bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
                Autonomous mode is active. Your agent will periodically wake up and take actions
                without your input. A daily budget cap is strongly recommended.
              </div>
              <div className="bg-yellow-500/10 border border-yellow-500/30 px-3 py-2 text-xs text-yellow-400">
                Your API key will be stored server-side (encrypted) so the agent can operate
                while you are offline. It will be automatically deleted when you disable autonomous mode.
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-text/70">
                Enable autonomous heartbeat
              </label>
              <p className="text-xs text-text/30 mt-0.5">
                Agent wakes periodically to check heartbeat.md for tasks.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={chatSettings.autonomousEnabled}
              onClick={() =>
                setChatSettings((s) => ({
                  ...s,
                  autonomousEnabled: !s.autonomousEnabled,
                }))
              }
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center border transition-colors ${
                chatSettings.autonomousEnabled
                  ? "bg-red-600 border-red-500/50"
                  : "bg-background border-primary/30"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform bg-text transition-transform ${
                  chatSettings.autonomousEnabled
                    ? "translate-x-6"
                    : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm text-text/70">
                Heartbeat interval
              </label>
              <span className="text-sm font-mono text-highlight">
                {chatSettings.heartbeatIntervalMinutes}m
              </span>
            </div>
            <input
              type="range"
              min={5}
              max={120}
              step={5}
              value={chatSettings.heartbeatIntervalMinutes}
              onChange={(e) =>
                setChatSettings((s) => ({
                  ...s,
                  heartbeatIntervalMinutes: Number(e.target.value),
                }))
              }
              className="w-full accent-primary"
              disabled={!chatSettings.autonomousEnabled}
            />
            <p className="text-xs text-text/30 mt-1">
              How often the agent wakes to check for tasks (5–120 minutes).
            </p>
          </div>

          <div>
            <label
              htmlFor="budget-cap"
              className="text-sm text-text/70 block mb-1.5"
            >
              Daily budget cap (USD)
            </label>
            <input
              id="budget-cap"
              type="number"
              min={0}
              step={0.01}
              value={chatSettings.dailyBudgetCapUsd ?? ""}
              onChange={(e) =>
                setChatSettings((s) => ({
                  ...s,
                  dailyBudgetCapUsd: e.target.value ? Number(e.target.value) : null,
                }))
              }
              placeholder="No limit"
              className="w-full bg-background border border-primary/30 px-3 py-2 text-sm text-text placeholder:text-text/40 focus:outline-none focus:border-highlight transition-colors font-mono"
              disabled={!chatSettings.autonomousEnabled}
            />
            <p className="text-xs text-text/30 mt-1">
              Auto-pauses heartbeat when daily spending exceeds this amount. Leave empty for no limit.
            </p>
          </div>

          <div>
            <label
              htmlFor="triage-model"
              className="text-sm text-text/70 block mb-1.5"
            >
              Triage model
            </label>
            <select
              id="triage-model"
              value={chatSettings.triageModel}
              onChange={(e) =>
                setChatSettings((s) => ({
                  ...s,
                  triageModel: e.target.value,
                }))
              }
              className="w-full bg-background border border-primary/30 px-3 py-2 text-sm text-text focus:outline-none focus:border-highlight transition-colors"
              disabled={!chatSettings.autonomousEnabled}
            >
              <option value="claude-haiku-4-5-20251001">Haiku 4.5 (cheapest)</option>
              <option value="claude-sonnet-4-5-20250929">Sonnet 4.5</option>
            </select>
            <p className="text-xs text-text/30 mt-1">
              Model used to decide if anything needs attention. Haiku recommended (~$0.024/day idle).
            </p>
          </div>

          <div>
            <label
              htmlFor="escalation-model"
              className="text-sm text-text/70 block mb-1.5"
            >
              Escalation model
            </label>
            <select
              id="escalation-model"
              value={chatSettings.escalationModel}
              onChange={(e) =>
                setChatSettings((s) => ({
                  ...s,
                  escalationModel: e.target.value,
                }))
              }
              className="w-full bg-background border border-primary/30 px-3 py-2 text-sm text-text focus:outline-none focus:border-highlight transition-colors"
              disabled={!chatSettings.autonomousEnabled}
            >
              <option value="claude-sonnet-4-5-20250929">Sonnet 4.5</option>
              <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
            </select>
            <p className="text-xs text-text/30 mt-1">
              Model used when triage determines action is needed.
            </p>
          </div>

          <Button
            onClick={handleSaveAutonomous}
            disabled={autonomousSaving}
          >
            {autonomousSaving ? "Saving..." : "Save Autonomous Settings"}
          </Button>

          {autonomousStatus && (
            <p className={`text-xs ${chatSettings.autonomousEnabled ? "text-red-400" : "text-highlight"}`}>
              {autonomousStatus}
            </p>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-text/70 mb-4">Account</h2>
        <Button variant="secondary" onClick={signOut}>
          Sign Out
        </Button>
      </Card>

      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <Card className="w-full max-w-md mx-4">
            <h2 className="text-base font-bold text-highlight mb-2">
              Save Your Private Key
            </h2>
            <p className="text-sm text-text/60 mb-4">
              This is your decryption key. It is saved in your browser, but if
              you clear your data it will be lost. Copy it now and keep it
              somewhere safe — you can re-enter it later.
            </p>
            <div className="bg-background border border-primary/30 p-3 mb-4 break-all font-mono text-xs text-text/80 select-all">
              {exportedPrivateKey}
            </div>
            <div className="flex gap-3">
              <Button onClick={handleCopyKey}>
                {copied ? "Copied" : "Copy Key"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowKeyModal(false)}
              >
                I saved it
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
