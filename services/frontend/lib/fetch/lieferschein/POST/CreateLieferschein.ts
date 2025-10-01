"use server";

import { cookies } from "next/headers";

type Result = {
  result: string;
};

type ErrorResponse = {
  success: false;
  error: string;
  message: string;
};

type SuccessResponse = {
  success: true;
  data: Result;
};

export default async function CreateLieferschein(
  abholer: string,
  kostenstelle_von: string,
  kostenstelle_zu: string,
  artikel: any,
): Promise<SuccessResponse | ErrorResponse> {
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
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/lieferschein/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token.value,
        },
        body: JSON.stringify({
          abholer: abholer,
          kostenstelle_von: kostenstelle_von,
          kostenstelle_zu: kostenstelle_zu,
          artikel: artikel,
        }),
      },
    );

    if (!res.ok) {
      const errorData = await res.json();

      return {
        success: false,
        error: `API error: ${res.status} ${res.statusText}`,
        message: errorData.message || "An error occurred",
      };
    }

    const data = await res.json();

    return {
      success: true,
      data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
      message: "Failed to create lieferschein",
    };
  }
}
