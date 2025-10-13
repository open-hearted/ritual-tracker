// Public configuration endpoint.
// Returns only non-sensitive, client-side configuration (e.g. GOOGLE_CLIENT_ID).
export default function handler(req, res){
  try{
    const googleClientId = process.env.GOOGLE_CLIENT_ID || null;
    return res.status(200).json({ googleClientId });
  }catch(e){
    return res.status(500).json({ googleClientId: null });
  }
}
