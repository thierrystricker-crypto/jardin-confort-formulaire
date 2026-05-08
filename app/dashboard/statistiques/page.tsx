import Link from "next/link";

export default function StatistiquesPage() {
  return (
    <div style={{ padding: 30, maxWidth: 1200, margin: "0 auto" }}>
      <Link href="/dashboard" style={{ color: "#2b8ad1", fontSize: 13, textDecoration: "none" }}>
        ← Retour au dashboard
      </Link>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: "#111", marginTop: 16, marginBottom: 8 }}>
        📊 Statistiques
      </h1>
      <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 24 }}>
        Page en cours de construction. Bientôt disponible :
      </p>
      <ul style={{ color: "#444", fontSize: 14, lineHeight: 1.8, paddingLeft: 20 }}>
        <li>📋 Tableau par commercial (CA, nb commandes, panier moyen) avec filtres période</li>
        <li>📈 Graphique CA quotidien sur 30 / 90 / 365 jours</li>
        <li>🗓️ Comparatif exercices comptables (1.10 → 30.09) année N vs N-1</li>
        <li>🏆 Top produits / SKU les plus vendus sur la période</li>
      </ul>
    </div>
  );
}