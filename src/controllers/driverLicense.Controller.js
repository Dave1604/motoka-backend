import { getSupabaseAdmin } from "../config/supabase.js";

const supabase = getSupabaseAdmin();

// Helper: generate license number
const generateLicenseNumber = () => {
  return `DL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
};

// Create / Renew / Lost-Damaged license
export const createDriverLicense = async (req, res) => {
  try {
    const userId = req.user.id; // ✅ Supabase auth UUID

    const {
      license_type,
      full_name,
      phone_number,
      address,
      date_of_birth,
      place_of_birth,
      state_of_origin,
      local_government,
      blood_group,
      height,
      occupation,
      next_of_kin,
      next_of_kin_phone,
      mother_maiden_name,
      license_year,
      expired_license_upload,
      license_number
    } = req.body;

    if (!["new", "renew", "lost_damaged"].includes(license_type)) {
      return res.status(400).json({
        status: false,
        message: "Invalid license type"
      });
    }

    const payload = {
      user_id: userId,
      license_type,
      status: "unpaid"
    };

    // ================= NEW LICENSE =================
    if (license_type === "new") {
      if (!full_name || !phone_number || !address || !date_of_birth || !license_year) {
        return res.status(400).json({
          status: false,
          message: "Missing required fields for new license"
        });
      }

      Object.assign(payload, {
        full_name,
        phone_number,
        address,
        date_of_birth,
        place_of_birth,
        state_of_origin,
        local_government,
        blood_group,
        height,
        occupation,
        next_of_kin,
        next_of_kin_phone,
        mother_maiden_name,
        license_year,
        license_number: generateLicenseNumber()
      });
    }

    // ================= RENEW LICENSE =================
    if (license_type === "renew") {
      if (!expired_license_upload) {
        return res.status(400).json({
          status: false,
          message: "Expired license upload is required"
        });
      }

      payload.expired_license_upload = expired_license_upload;
    }

    // ================= LOST / DAMAGED =================
    if (license_type === "lost_damaged") {
      if (!license_number || !date_of_birth) {
        return res.status(400).json({
          status: false,
          message: "License number and date of birth are required"
        });
      }

      payload.license_number = license_number;
      payload.date_of_birth = date_of_birth;
    }

    const { data, error } = await supabase
      .from("drivers_licenses")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({
      status: true,
      message: "Driver license request created",
      data
    });

  } catch (error) {
    console.error("Create license error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to create driver license"
    });
  }
};

// ================= GET USER LICENSES =================
export const getDriverLicenses = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from("drivers_licenses")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      status: true,
      data
    });
  } catch (error) {
    console.error("Fetch licenses error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch licenses"
    });
  }
};

// ================= GET SINGLE LICENSE =================
export const getDriverLicenseBySlug = async (req, res) => {
  try {
    const userId = req.user.id;
    const { slug } = req.params;

    const { data, error } = await supabase
      .from("drivers_licenses")
      .select("*")
      .eq("slug", slug)
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return res.status(404).json({
        status: false,
        message: "License not found"
      });
    }

    return res.status(200).json({
      status: true,
      data
    });
  } catch (error) {
    console.error("Fetch license error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch license"
    });
  }
};
