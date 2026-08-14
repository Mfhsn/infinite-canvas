export const PLATFORM_HOME_URL = "/";
export const PLATFORM_LOGIN_URL = "/?login=true";

type AssignableLocation = Pick<Location, "assign">;

export function redirectToPlatformLogin(location: AssignableLocation | undefined = typeof window === "undefined" ? undefined : window.location) {
    location?.assign(PLATFORM_LOGIN_URL);
}
