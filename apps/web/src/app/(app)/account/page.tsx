import { redirect } from "next/navigation";
import { MY_ACCOUNT_ROUTE } from "@/lib/routes";

/**
 * Account moved into Management → My Account. Old links / bookmarks
 * land here and bounce server-side; this avoids a 404 without keeping
 * a duplicate page around.
 */
export default function AccountPage() {
  redirect(MY_ACCOUNT_ROUTE);
}
