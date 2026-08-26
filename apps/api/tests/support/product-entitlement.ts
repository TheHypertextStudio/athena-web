/**
 * Install the complimentary Docket Pro fixture used by product-surface regression suites.
 *
 * @param client - A disposable Postgres-compatible test client that can execute SQL batches.
 */
export async function installTestProductEntitlementFixture(client: {
  exec(sql: string): Promise<unknown>;
}): Promise<void> {
  await client.exec(`
CREATE OR REPLACE FUNCTION test_grant_docket_pro_to_org()
RETURNS trigger AS $$
BEGIN
  INSERT INTO organization_product_entitlement (
    organization_id,
    product_key,
    status,
    source
  ) VALUES (
    NEW.id,
    'docket_pro',
    'active'::product_entitlement_status,
    'complimentary'::product_entitlement_source
  ) ON CONFLICT (organization_id, product_key) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS test_org_docket_pro ON organization;

CREATE TRIGGER test_org_docket_pro
AFTER INSERT ON organization
FOR EACH ROW
EXECUTE FUNCTION test_grant_docket_pro_to_org();
`);
}
