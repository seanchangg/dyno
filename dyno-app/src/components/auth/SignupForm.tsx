"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";

interface SignupFormProps {
  onSwitchToLogin?: () => void;
}

export default function SignupForm({ onSwitchToLogin }: SignupFormProps) {
  const { signUp } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAlreadyRegistered(false);
    setLoading(true);
    const { error: err } = await signUp(email, password, username, fullName);
    if (err === "already_registered") {
      setAlreadyRegistered(true);
      setLoading(false);
    } else if (err) {
      setError(err);
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        id="signup-username"
        label="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="marty_user"
        required
      />
      <Input
        id="signup-fullname"
        label="Full Name"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="Jane Doe"
        required
      />
      <Input
        id="signup-email"
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        required
      />
      <Input
        id="signup-password"
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Min 6 characters"
        minLength={6}
        required
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      {alreadyRegistered && (
        <div className="bg-surface border border-secondary/30 px-4 py-3 text-sm">
          <p className="text-highlight mb-2">
            This email is already registered.
          </p>
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="text-secondary hover:text-highlight transition-colors underline"
          >
            Sign in instead
          </button>
        </div>
      )}
      <Button type="submit" disabled={loading}>
        {loading ? "Creating account..." : "Sign Up"}
      </Button>
    </form>
  );
}
