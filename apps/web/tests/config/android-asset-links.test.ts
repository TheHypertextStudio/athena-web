import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Android Digital Asset Links', () => {
  it('publishes the installed Docket app as a shared-credential target', () => {
    const path = resolve(process.cwd(), 'public/.well-known/assetlinks.json');
    const association = JSON.parse(readFileSync(path, 'utf8')) as unknown;

    expect(association).toEqual([
      {
        relation: [
          'delegate_permission/common.handle_all_urls',
          'delegate_permission/common.get_login_creds',
        ],
        target: {
          namespace: 'android_app',
          package_name: 'studio.hypertext.docket',
          sha256_cert_fingerprints: [
            'DF:32:69:D4:DC:C9:C4:FE:72:FE:61:62:A0:F4:E9:EE:5F:04:14:47:DC:B3:8E:F6:A9:25:76:FC:38:90:DB:C7',
          ],
        },
      },
    ]);
  });
});
