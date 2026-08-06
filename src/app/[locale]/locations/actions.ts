"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { routes } from "@/config/routes";
import { FIELD_LIMITS } from "@/config/validation";
import { location } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { ActionResult } from "@/lib/action-result";
import {
  optionalText,
  requiredText,
  requiredUuid,
  runAuthorizedAction,
} from "@/lib/actions";

/** Écritures sur les lieux : bassins et sites où se déroulent les cours. */

const LOCATIONS_PATH = `/[locale]${routes.locations}`;

function revalidateLocations() {
  revalidatePath(LOCATIONS_PATH, "page");
}

export async function createLocation(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("location:write", async (context) => {
    const name = requiredText(formData, "name", FIELD_LIMITS.name);
    const address = optionalText(formData, "address", FIELD_LIMITS.address);

    await withTenant(context.organizationId, (tx) =>
      tx.insert(location).values({
        organizationId: context.organizationId,
        name,
        address,
      }),
    );

    revalidateLocations();
  });
}

export async function updateLocation(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("location:write", async (context) => {
    const locationId = requiredUuid(formData, "locationId");
    const name = requiredText(formData, "name", FIELD_LIMITS.name);
    const address = optionalText(formData, "address", FIELD_LIMITS.address);

    await withTenant(context.organizationId, (tx) =>
      tx
        .update(location)
        .set({ name, address })
        .where(
          and(
            eq(location.id, locationId),
            eq(location.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateLocations();
  });
}

export async function deleteLocation(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("location:write", async (context) => {
    const locationId = requiredUuid(formData, "locationId");

    await withTenant(context.organizationId, (tx) =>
      tx
        .delete(location)
        .where(
          and(
            eq(location.id, locationId),
            eq(location.organizationId, context.organizationId),
          ),
        ),
    );

    revalidateLocations();
  });
}
