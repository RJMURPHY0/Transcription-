// Correct a meeting's type.
//
// The type is classified from the transcript at finalize, which gets the common
// cases right and will occasionally be wrong on a borderline one — an internal
// product demo that reads like a sales call, say. Without a way to correct it,
// one bad guess is permanent and the meeting-type filter stops being
// trustworthy. A user's correction is final: it is never reclassified.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAuthUser, canAccessRecording } from '@/lib/auth';
import { logAudit, requestIp } from '@/lib/audit';
import { MEETING_TYPES } from '@/lib/recording-filters';

export const dynamic = 'force-dynamic';

const CUID_RE = /^c[a-z0-9]{20,}$/;

// PATCH /api/recordings/[id]/meeting-type
// Body: { meetingType: 'general' | 'standup' | 'sales' | 'interview' | 'review' }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!CUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Invalid recording ID.' }, { status: 400 });
  }

  const body = await req.json().catch(() => null) as { meetingType?: string } | null;
  const meetingType = body?.meetingType;
  // 'auto' is not offered here: this endpoint exists to record a human decision.
  if (!meetingType || !(MEETING_TYPES as readonly string[]).includes(meetingType)) {
    return NextResponse.json({ error: 'Unknown meeting type.' }, { status: 400 });
  }

  const user = await getAuthUser();
  const rec = await prisma.recording.findUnique({
    where: { id: params.id },
    select: { userId: true, orgId: true, deletedAt: true, meetingType: true },
  });
  if (!rec || rec.deletedAt) {
    return NextResponse.json({ error: 'Recording not found.' }, { status: 404 });
  }
  if (!canAccessRecording(rec, user)) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  }

  await prisma.recording.update({ where: { id: params.id }, data: { meetingType } });

  await logAudit({
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    action: 'recording.meeting_type.update',
    targetType: 'recording',
    targetId: params.id,
    ip: requestIp(req),
    metadata: { from: rec.meetingType, to: meetingType },
  });

  return NextResponse.json({ meetingType });
}
