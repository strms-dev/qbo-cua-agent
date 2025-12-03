/**
 * GET /api/files/[id]/download - Generate signed URL for file download
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const STORAGE_BUCKET = 'cua-downloads';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'File ID is required' }, { status: 400 });
  }

  try {
    // Get the file record
    const { data: file, error: fileError } = await supabase
      .from('downloaded_files')
      .select('id, filename, supabase_path')
      .eq('id', id)
      .single();

    if (fileError || !file) {
      console.error('Error fetching file:', fileError);
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Generate a signed URL (valid for 1 hour)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(file.supabase_path, 3600); // 1 hour expiry

    if (signedUrlError || !signedUrlData) {
      console.error('Error creating signed URL:', signedUrlError);
      return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 });
    }

    return NextResponse.json({
      downloadUrl: signedUrlData.signedUrl,
      filename: file.filename,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error('Unexpected error in download API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
