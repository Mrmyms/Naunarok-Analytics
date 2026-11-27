import { NextResponse } from 'next/server';
import { fetchPitPhotoById } from '@/lib/googleSheets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id')?.trim();
    const eventCode = searchParams.get('event')?.trim() || undefined;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Se requiere el parámetro id' },
        { status: 400 }
      );
    }

    const photo = await fetchPitPhotoById(id, eventCode);
    if (!photo) {
      return NextResponse.json(
        { success: false, error: 'Foto no encontrada' },
        { status: 404 }
      );
    }

    const safeFileName = (photo.fileName || 'photo').replace(/["\\\r\n]/g, '_');
    return new NextResponse(new Uint8Array(photo.buffer), {
      status: 200,
      headers: {
        'Content-Type': photo.mimeType,
        'Content-Disposition': `inline; filename="${safeFileName}"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error: any) {
    console.error('Error sirviendo foto de Pit en Analytics:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Error al obtener la foto' },
      { status: 500 }
    );
  }
}
