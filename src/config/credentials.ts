export function getFrontendMastersCredentials(): {
  username: string;
  password: string;
} {
  const username = process.env.FRONTENDMASTERS_USERNAME?.trim();
  const password = process.env.FRONTENDMASTERS_PASSWORD?.trim();

  if (!username || !password) {
    throw new Error(
      "Set FRONTENDMASTERS_USERNAME and FRONTENDMASTERS_PASSWORD in a .env file (see .env.example).",
    );
  }

  return { username, password };
}
