export async function GET() {
  const apiKey = process.env.GOOGLE_AI_API_KEY || "";
  if (!apiKey) {
    return Response.json({ error: "GOOGLE_AI_API_KEY not set" }, { status: 500 });
  }
  return Response.json({ apiKey });
}
