// app/dashboard/claude/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Chat Claude intégré au dashboard (13.08.2026). Usage interne uniquement.
//
// Composant client : fil de messages, streaming SSE depuis /api/claude/chat,
// rendu markdown minimal (liens cliquables tels quels — règles Jardi —, gras,
// code inline). La page est protégée par proxy.ts comme le reste du dashboard.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type React from "react";

type MessageChat = { role: "user" | "assistant"; content: string };
type MessageAffiche = MessageChat & { outils?: string[]; erreur?: boolean };

type EvenementStream = {
  type: string;
  content_block?: { type?: string; name?: string };
  delta?: { type?: string; text?: string };
  error?: { message?: string };
};

// ── Rendu markdown minimal ───────────────────────────────────────────────────
// Liens [texte](url), URLs nues, **gras**, `code`. Les retours à la ligne sont
// préservés par white-space: pre-wrap. Aucun lien n'est fabriqué ni modifié :
// on rend cliquable exactement ce que le texte contient.
const MOTIF_INLINE =
  /\[([^\]]+)\]\(([a-z][a-z0-9+.-]*:[^\s)]+)\)|(https?:\/\/[^\s<>"')]+)|\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;

function renduInline(texte: string): React.ReactNode[] {
  const noeuds: React.ReactNode[] = [];
  let curseur = 0;
  let cle = 0;
  for (const m of texte.matchAll(MOTIF_INLINE)) {
    const debut = m.index ?? 0;
    if (debut > curseur) noeuds.push(texte.slice(curseur, debut));
    if (m[1] !== undefined && m[2] !== undefined) {
      // [texte](url)
      noeuds.push(
        <a
          key={`l${cle++}`}
          href={m[2]}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#7dd3fc", textDecoration: "underline", wordBreak: "break-all" }}
        >
          {m[1]}
        </a>
      );
    } else if (m[3] !== undefined) {
      // URL nue — retirer la ponctuation finale du texte courant
      let url = m[3];
      let suite = "";
      while (url.length > 0 && ".,;:!?»".includes(url[url.length - 1])) {
        suite = url[url.length - 1] + suite;
        url = url.slice(0, -1);
      }
      noeuds.push(
        <a
          key={`u${cle++}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#7dd3fc", textDecoration: "underline", wordBreak: "break-all" }}
        >
          {url}
        </a>
      );
      if (suite) noeuds.push(suite);
    } else if (m[4] !== undefined) {
      noeuds.push(<strong key={`g${cle++}`}>{m[4]}</strong>);
    } else if (m[5] !== undefined) {
      noeuds.push(
        <code
          key={`c${cle++}`}
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: "0.92em",
            background: "rgba(255,255,255,0.12)",
            borderRadius: 4,
            padding: "1px 4px",
          }}
        >
          {m[5]}
        </code>
      );
    }
    curseur = debut + m[0].length;
  }
  if (curseur < texte.length) noeuds.push(texte.slice(curseur));
  return noeuds;
}

const EXEMPLES = [
  "mails Fermob de cette semaine",
  "dernier mail Dedon",
  "cherche le client Rochat à Pully",
  "stats de ventes de juillet",
];

export default function PageChatClaude() {
  const [messages, setMessages] = useState<MessageAffiche[]>([]);
  const [saisie, setSaisie] = useState("");
  const [enCours, setEnCours] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);
  const zoneRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Met à jour le dernier message (celui de l'assistant en cours de streaming).
  const majDernier = (fn: (m: MessageAffiche) => MessageAffiche) => {
    setMessages((prec) =>
      prec.map((m, i) => (i === prec.length - 1 ? fn(m) : m))
    );
  };

  const envoyer = async (texteForce?: string) => {
    const texte = (texteForce ?? saisie).trim();
    if (!texte || enCours) return;
    setSaisie("");

    // Historique envoyé au serveur (les erreurs affichées n'en font pas partie ;
    // la troncature fine est faite côté serveur).
    const historique: MessageChat[] = [
      ...messages
        .filter((m) => !m.erreur && m.content)
        .map(({ role, content }) => ({ role, content })),
      { role: "user", content: texte },
    ];

    setMessages((prec) => [
      ...prec,
      { role: "user", content: texte },
      { role: "assistant", content: "", outils: [] },
    ]);
    setEnCours(true);

    try {
      const reponse = await fetch("/api/claude/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: historique }),
      });

      if (!reponse.ok || !reponse.body) {
        let detail = "Erreur inattendue. Réessaie dans un instant.";
        if (reponse.status === 401) {
          detail = "Session expirée — recharge la page pour saisir le code d'accès.";
        } else {
          try {
            const corps = (await reponse.json()) as { error?: string };
            if (corps.error) detail = corps.error;
          } catch {
            /* corps non JSON */
          }
        }
        majDernier((m) => ({ ...m, content: detail, erreur: true }));
        return;
      }

      const lecteur = reponse.body.getReader();
      const decodeur = new TextDecoder();
      let tampon = "";

      const traiter = (evt: EvenementStream) => {
        if (evt.type === "content_block_start" && evt.content_block) {
          if (evt.content_block.type === "mcp_tool_use" && evt.content_block.name) {
            const nom = evt.content_block.name;
            majDernier((m) => ({ ...m, outils: [...(m.outils ?? []), nom] }));
          } else if (evt.content_block.type === "text") {
            // Nouveau bloc de texte après un appel d'outil → saut de paragraphe.
            majDernier((m) =>
              m.content ? { ...m, content: m.content + "\n\n" } : m
            );
          }
        } else if (
          evt.type === "content_block_delta" &&
          evt.delta?.type === "text_delta" &&
          evt.delta.text
        ) {
          const morceau = evt.delta.text;
          majDernier((m) => ({ ...m, content: m.content + morceau }));
        } else if (evt.type === "error") {
          const msg = evt.error?.message ?? "Erreur du service Claude.";
          majDernier((m) => ({
            ...m,
            content: m.content ? m.content + "\n\n⚠️ " + msg : "⚠️ " + msg,
            erreur: !m.content,
          }));
        }
      };

      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        tampon += decodeur.decode(value, { stream: true });
        const blocs = tampon.split(/\r?\n\r?\n/);
        tampon = blocs.pop() ?? "";
        for (const bloc of blocs) {
          for (const ligne of bloc.split(/\r?\n/)) {
            if (!ligne.startsWith("data:")) continue;
            const brut = ligne.slice(5).trim();
            if (!brut) continue;
            try {
              traiter(JSON.parse(brut) as EvenementStream);
            } catch {
              /* fragment non JSON — ignoré */
            }
          }
        }
      }

      majDernier((m) =>
        m.content || (m.outils && m.outils.length)
          ? m
          : { ...m, content: "Réponse vide — réessaie.", erreur: true }
      );
    } catch {
      majDernier((m) => ({
        ...m,
        content: "Connexion interrompue. Réessaie dans un instant.",
        erreur: true,
      }));
    } finally {
      setEnCours(false);
      zoneRef.current?.focus();
    }
  };

  const surTouche = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      envoyer();
    }
  };

  return (
    // Fond sombre forcé, comme le dashboard principal (bg-[#1f2125]) — ne
    // dépend pas du thème clair/sombre du navigateur.
    <div style={{ background: "#1f2125", minHeight: "100dvh", color: "#ededed" }}>
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        maxWidth: 860,
        margin: "0 auto",
        padding: "16px 16px 12px",
      }}
    >
      {/* En-tête */}
      <div style={{ flexShrink: 0, paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <Link
          href="/dashboard"
          style={{ color: "#7dd3fc", fontSize: 13, textDecoration: "none" }}
        >
          ← Retour au dashboard
        </Link>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#f4f4f5", marginTop: 8, marginBottom: 2 }}>
          💬 Claude
        </h1>
        <p style={{ color: "#a1a1aa", fontSize: 13, margin: 0 }}>
          Mails, clients, commandes, statistiques — usage interne. Lecture seule :
          Claude ne peut rien envoyer, uniquement déposer des brouillons à relire
          dans Thunderbird.
        </p>
      </div>

      {/* Fil de messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 4px" }}>
        {messages.length === 0 && (
          <div style={{ color: "#a1a1aa", fontSize: 14, marginTop: 24 }}>
            <p style={{ marginBottom: 12 }}>Quelques exemples pour démarrer :</p>
            {EXEMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => envoyer(ex)}
                style={{
                  display: "block",
                  marginBottom: 8,
                  padding: "8px 12px",
                  fontSize: 13,
                  color: "#7dd3fc",
                  background: "rgba(56,189,248,0.08)",
                  border: "1px solid rgba(56,189,248,0.25)",
                  borderRadius: 8,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                maxWidth: "85%",
                padding: "10px 14px",
                borderRadius: 14,
                fontSize: 14,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: m.role === "user" ? "#2B8AD1" : m.erreur ? "rgba(244,63,94,0.12)" : "#2a2d31",
                color: m.role === "user" ? "#fff" : m.erreur ? "#fda4af" : "#e4e4e7",
                border: m.erreur
                  ? "1px solid rgba(244,63,94,0.35)"
                  : m.role === "assistant"
                  ? "1px solid rgba(255,255,255,0.06)"
                  : "none",
              }}
            >
              {m.outils && m.outils.length > 0 && (
                <div style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic", marginBottom: m.content ? 6 : 0 }}>
                  🔧 {m.outils.join(" · ")}
                </div>
              )}
              {m.role === "assistant" ? renduInline(m.content) : m.content}
              {m.role === "assistant" &&
                enCours &&
                i === messages.length - 1 &&
                !m.erreur && <span style={{ color: "#9ca3af" }}> ▍</span>}
            </div>
          </div>
        ))}
        <div ref={finRef} />
      </div>

      {/* Zone de saisie */}
      <div style={{ flexShrink: 0, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          ref={zoneRef}
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          onKeyDown={surTouche}
          rows={2}
          placeholder="Écris à Claude… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)"
          disabled={enCours}
          style={{
            flex: 1,
            resize: "none",
            padding: "10px 12px",
            fontSize: 14,
            fontFamily: "inherit",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 10,
            outline: "none",
            background: enCours ? "#26292d" : "#2a2d31",
            color: "#ededed",
          }}
        />
        <button
          onClick={() => envoyer()}
          disabled={enCours || !saisie.trim()}
          style={{
            padding: "10px 18px",
            fontSize: 14,
            fontWeight: 600,
            color: "#fff",
            background: enCours || !saisie.trim() ? "#3f4348" : "#2B8AD1",
            border: "none",
            borderRadius: 10,
            cursor: enCours || !saisie.trim() ? "default" : "pointer",
          }}
        >
          {enCours ? "…" : "Envoyer"}
        </button>
      </div>
    </div>
    </div>
  );
}
