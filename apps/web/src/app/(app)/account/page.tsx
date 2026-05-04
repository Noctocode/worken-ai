import { redirect } from "next/navigation";

/**
 * Account moved into Management → My Account. Old links / bookmarks
 * land here and bounce server-side; this avoids a 404 without keeping
 * a duplicate page around.
 */
export default function AccountPage() {
  redirect("/teams?tab=my-account");
}
