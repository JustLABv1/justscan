"use server";

import { cookies } from "next/headers";

export async function PostUploadKostenstellen(formData: FormData) {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;

    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    // Forward to Go backend
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/kostenstellen/`,
      {
        method: "POST",
        headers: {
          Authorization: `${session}`,
        },
        body: formData,
      },
    );

    if (!response.ok) {
      return {
        success: false,
        error: `Backend upload failed: ${response.status}`,
      };
    }

    const data = await response.json();

    return { success: true, data };
  } catch {
    return { success: false, error: "Upload failed" };
  }
}
