import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Connexion — Espace équipe COM ICC Le Mans" },
      {
        name: "description",
        content: "Connexion et création d’accès à l’espace équipe COM ICC Le Mans.",
      },
    ],
  }),
  component: AuthPage,
});
type Mode = "signin" | "signup" | "forgot" | "recovery" | "success";
const authUrl = () => new URL(`${import.meta.env.BASE_URL}auth`, window.location.origin).toString();
function friendlyError(message: string) {
  const text = message.toLowerCase();
  if (text.includes("invalid login credentials"))
    return "Adresse e-mail ou mot de passe incorrect.";
  if (text.includes("user already registered"))
    return "Un compte existe déjà avec cette adresse. Utilise « Mot de passe oublié ? » si nécessaire.";
  if (text.includes("password should be"))
    return "Le mot de passe doit contenir au moins 8 caractères.";
  if (text.includes("database error saving new user"))
    return "Cette adresse ne correspond pas à une fiche membre autorisée, ou elle est déjà rattachée à un compte.";
  if (text.includes("email rate limit"))
    return "Trop de messages ont été demandés. Patiente quelques minutes avant de réessayer.";
  return message;
}

function AuthPage() {
  const router = useRouter(),
    [mode, setMode] = useState<Mode>("signin"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const recoveryInUrl =
      new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
    if (recoveryInUrl) setMode("recovery");
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setMode("recovery");
      else if (session && !recoveryInUrl && event === "SIGNED_IN")
        router.navigate({ to: "/tableau-de-bord" });
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session && !recoveryInUrl) router.navigate({ to: "/tableau-de-bord" });
    });
    return () => listener.subscription.unsubscribe();
  }, [router]);
  function switchMode(next: Mode) {
    setMode(next);
    setPassword("");
    setConfirmation("");
  }
  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error)
      return toast.error("Connexion impossible", { description: friendlyError(error.message) });
    router.navigate({ to: "/tableau-de-bord" });
  }
  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("Choisis un mot de passe d’au moins 8 caractères.");
    if (password !== confirmation)
      return toast.error("Les deux mots de passe ne sont pas identiques.");
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: authUrl() },
    });
    setBusy(false);
    if (error)
      return toast.error("Inscription impossible", { description: friendlyError(error.message) });
    setMode("success");
    setPassword("");
    setConfirmation("");
  }
  async function forgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: authUrl(),
    });
    setBusy(false);
    if (error)
      return toast.error("Envoi impossible", { description: friendlyError(error.message) });
    toast.success("Lien envoyé", {
      description: "Consulte ta boîte e-mail pour choisir un nouveau mot de passe.",
    });
    setMode("signin");
  }
  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("Choisis un mot de passe d’au moins 8 caractères.");
    if (password !== confirmation)
      return toast.error("Les deux mots de passe ne sont pas identiques.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error)
      return toast.error("Modification impossible", { description: friendlyError(error.message) });
    toast.success("Mot de passe modifié");
    router.navigate({ to: "/tableau-de-bord" });
  }
  const submit =
    mode === "signup"
      ? signUp
      : mode === "forgot"
        ? forgotPassword
        : mode === "recovery"
          ? updatePassword
          : signIn;
  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl">
        <p className="font-display text-xl font-semibold">COM ICC Le Mans</p>
        <p className="mt-1 text-sm text-muted-foreground">Espace équipe — accès réservé.</p>
        {mode === "success" ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
              <p className="font-bold">Inscription réussie</p>
              <p className="mt-1 text-sm">
                Consulte ta boîte e-mail pour confirmer ton adresse si un message t’a été envoyé,
                puis connecte-toi.
              </p>
            </div>
            <Button className="w-full" onClick={() => switchMode("signin")}>
              Se connecter
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode !== "recovery" ? (
              <div className="space-y-1.5">
                <Label htmlFor="email">Adresse e-mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            ) : null}
            {mode !== "forgot" ? (
              <div className="space-y-1.5">
                <Label htmlFor="password">
                  {mode === "recovery" ? "Nouveau mot de passe" : "Mot de passe"}
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  minLength={mode === "signin" ? undefined : 8}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            ) : null}
            {mode === "signup" || mode === "recovery" ? (
              <div className="space-y-1.5">
                <Label htmlFor="confirmation">Confirmer le mot de passe</Label>
                <Input
                  id="confirmation"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </div>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy
                ? "Traitement…"
                : mode === "signup"
                  ? "Créer mon accès"
                  : mode === "forgot"
                    ? "Envoyer le lien"
                    : mode === "recovery"
                      ? "Enregistrer le nouveau mot de passe"
                      : "Se connecter"}
            </Button>
            {mode === "signin" ? (
              <div className="space-y-2 text-center text-sm">
                <button
                  type="button"
                  className="font-semibold text-icc-violet hover:underline"
                  onClick={() => switchMode("forgot")}
                >
                  Mot de passe oublié ?
                </button>
                <p>
                  Première connexion ?{" "}
                  <button
                    type="button"
                    className="font-bold text-icc-violet hover:underline"
                    onClick={() => switchMode("signup")}
                  >
                    S’inscrire
                  </button>
                </p>
              </div>
            ) : null}
            {mode === "signup" || mode === "forgot" ? (
              <button
                type="button"
                className="w-full text-center text-sm font-semibold text-icc-violet hover:underline"
                onClick={() => switchMode("signin")}
              >
                ← Retour à la connexion
              </button>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
