import type { OwnerType } from './common';

export interface Collection {
  id: string;
  name: string;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
  created_at: string;
  updated_at: string;
}
