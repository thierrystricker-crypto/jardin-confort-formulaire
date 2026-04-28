// app/api/clients/[id]/factures/upload/route.ts
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const formData = await request.formData()
    const file = formData.get("file") as File
    const numeroFacture = formData.get("numero_facture") as string

    if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const fileName = `facture_${numeroFacture}_${id}_${Date.now()}.pdf`
    const storagePath = `manuel/${fileName}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from("factures")
      .upload(storagePath, buffer, {
        contentType: "application/pdf",
        upsert: true,
      })

    if (uploadError) throw new Error(uploadError.message)

    const pdfUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/factures/${storagePath}`

    return NextResponse.json({ pdf_url: pdfUrl })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}