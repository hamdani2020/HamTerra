/**
 * The admin area. One module, so the router loads all admin pages as a single lazy chunk
 * (Requirement 24.4). Each page is a placeholder until its feature task.
 */
import { PlaceholderPage } from "@/components/common/PlaceholderPage";
import { PAGE_TITLE } from "@/lib/pageTitles";

export function AdminOverviewPage(): JSX.Element {
  return <PlaceholderPage title={PAGE_TITLE.admin} />;
}
export function AdminUsersPage(): JSX.Element {
  return <PlaceholderPage title={PAGE_TITLE.adminUsers} />;
}
export { AdminAreasPage } from "@/features/admin/AdminAreasPage";
export function AdminRetrievalsPage(): JSX.Element {
  return <PlaceholderPage title={PAGE_TITLE.adminRetrievals} />;
}
export function AdminSettingsPage(): JSX.Element {
  return <PlaceholderPage title={PAGE_TITLE.adminSettings} />;
}
export function AdminActivityPage(): JSX.Element {
  return <PlaceholderPage title={PAGE_TITLE.adminActivity} />;
}
