import { getSupabase } from "../config/supabase.js";

export const testSupabaseConnection = async (req, res) => {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .limit(1);

    if (error) throw error;

    res.json({
      success: true,
      message: "Supabase profiles table OK",
      data
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};
