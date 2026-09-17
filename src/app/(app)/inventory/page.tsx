import { redirect } from "next/navigation";

/**
 * Inventory and Vehicles were two views of the same thing. They are one page
 * now, under Vehicles. This redirect exists so an old link does not 404.
 */
export default function InventoryPage() {
  redirect("/vehicles");
}
