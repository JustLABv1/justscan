"use server";

import { cookies } from "next/headers";

type ErrorResponse = {
  success: false;
  error: string;
  message: string;
};

export async function GetBestellungPDF(
  id: string,
): Promise<{ success: true; blob: Blob } | ErrorResponse> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("session");

    if (!token) {
      return {
        success: false,
        error: "Authentication token not found",
        message: "User is not authenticated",
      };
    }

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/bestellungen/${id}/export`,
      {
        method: "GET",
        headers: {
          Authorization: token.value,
        },
      },
    );

    if (!res.ok) {
      return {
        success: false,
        error: `API error: ${res.status} ${res.statusText}`,
        message: "Failed to generate PDF",
      };
    }

    const blob = await res.blob();

    return {
      success: true,
      blob,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
      message: "Failed to fetch bestellung pdf",
    };
  }
}

export default GetBestellungPDF;
