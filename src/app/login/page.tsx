import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignInButton } from "./sign-in-button";

/**
 * Sign-in page with the Discord button and, after a failed attempt, the reason.
 *
 * @param props.searchParams carries `error` after a rejected sign-in
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardDescription>Roadmap</CardDescription>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Sign-in failed</AlertTitle>
              <AlertDescription>
                If your Discord account has not been added yet, ask an admin. Otherwise try again.{" "}
                <span className="font-mono text-xs">({error})</span>
              </AlertDescription>
            </Alert>
          )}
          <SignInButton />
        </CardContent>
      </Card>
    </main>
  );
}
