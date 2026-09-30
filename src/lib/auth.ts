import { useQuery } from "@tanstack/react-query";
import { unwrap } from "./local-api";

export type CurrentUser = {
  id: string;
  email: string | null;
  fullName: string;
  isActive: boolean;
  role: "admin" | "staff";
};

export function useCurrentUser() {
  return useQuery({
    queryKey: ["current-user"],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async (): Promise<CurrentUser | null> => {
      const session = await unwrap(window.api.auth.currentSession());
      if (!session) return null;
      return {
        id: session.userId,
        email: session.email,
        fullName: session.fullName,
        isActive: true,
        role: session.role,
      };
    },
  });
}

export function useIsAdmin() {
  const { data, isLoading } = useCurrentUser();
  return { isAdmin: data?.role === "admin", isLoading };
}
