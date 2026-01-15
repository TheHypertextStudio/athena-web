/**
 * Script to create a default calendar for a user.
 */
import { db } from '../src/db/index.js';
import { calendars } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';

async function main() {
  const userId = process.argv[2];

  if (!userId) {
    console.error('Usage: npx tsx scripts/create-default-calendar.ts <userId>');
    process.exit(1);
  }

  const existing = await db.select().from(calendars).where(eq(calendars.userId, userId));
  console.log('Existing calendars:', existing.length);

  if (existing.length === 0) {
    const [cal] = await db
      .insert(calendars)
      .values({
        id: crypto.randomUUID(),
        userId,
        name: 'Calendar',
        color: '#4285F4',
        ctag: crypto.randomUUID(),
        isDefault: true,
      })
      .returning();
    console.log('Created default calendar:', cal.id);
  } else {
    console.log(
      'Calendars:',
      existing.map((c) => c.name),
    );
  }

  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
