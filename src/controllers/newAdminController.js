import { getSupabaseAdmin } from "../config/supabase.js";
import * as response from "../utils/responses.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendEmail } from "../services/email/email.service.js"; // your email from services

//  Admin Login Request (send OTP)
export const adminLoginRequest = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return response.validationError(res, { email: "Email is required" });

    const supabaseAdmin = getSupabaseAdmin();

    // Fetch user by email
    const { data, error } = await supabaseAdmin.auth.admin.listUsers();

    if (error) {
      console.error("Admin verify error:", error);
      return response.serverError(res);
    }

    const user = data.users.find((u) => u.email === email);
    if (!user) {
      return response.notFound(res, "Admin email not found");
    }

    // fetch profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, is_admin, is_suspended")
      .eq("id", user.id)
      .single();

    if (profileError || !profile)
      return response.notFound(res, "Admin profile not found");
    if (!profile.is_admin)
      return response.forbidden(res, "User is not an admin");

    // Generate OTP (6-digit numeric)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex"); // Store OTP temporarily in DB (profiles table) with expiry 5 min
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min
    const { error: otpError } = await supabaseAdmin
      .from("profiles")
      .update({
        two_factor_email_code: otpHash,
        two_factor_email_expires_at: expiresAt,
      })
      .eq("id", user.id);

    if (otpError) {
      console.error("Failed to store OTP:", otpError);
      return response.serverError(res, "Failed to generate OTP");
    }

    // Send OTP via email
    await sendEmail({
      to: email,
      subject: "Your Admin Login OTP",
      text: `Your OTP code is: ${otp}. It expires in 5 minutes.`,
    });

    return response.success(res, { email }, "OTP sent to admin email");
  } catch (err) {
    console.error("Admin login request error:", err);
    return response.serverError(res);
  }
};

//  Admin Verify OTP (returns JWT)
export const adminVerifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp)
      return response.validationError(res, {
        email: "Required",
        otp: "Required",
      });

    const supabaseAdmin = getSupabaseAdmin();

    // Fetch user
    const { data, error } = await supabaseAdmin.auth.admin.listUsers();

    if (error) {
      console.error("Admin verify error:", error);
      return response.serverError(res);
    }

    const user = data.users.find((u) => u.email === email);
    if (!user) {
      return response.notFound(res, "Admin email not found");
    }

    
    // Fetch profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, is_admin, is_suspended, two_factor_email_code, two_factor_email_expires_at",
      )
      .eq("id", user.id)
      .single();

    if (profileError || !profile)
      return response.notFound(res, "Admin profile not found");
    if (!profile.is_admin)
      return response.forbidden(res, "User is not an admin");

    // Check OTP
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

    if (profile.two_factor_email_code !== otpHash)
      return response.unauthorized(res, "Invalid OTP");
    if (
      !profile.two_factor_email_expires_at ||
      new Date(profile.two_factor_email_expires_at) < new Date()
    ) {
      return response.unauthorized(res, "OTP expired");
    }

    // Clear OTP after use
    await supabaseAdmin
      .from("profiles")
      .update({
        two_factor_email_code: null,
        two_factor_email_expires_at: null,
      })
      .eq("id", user.id);

    // Create JWT (30 mins expiry)
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        is_admin: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30m" },
    );

    return response.success(res, { token }, "Admin login successful");
  } catch (err) {
    console.error("Admin verify OTP error:", err);
    return response.serverError(res);
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const search = req.query.search?.trim() || "";
    const status = req.query.status || "active";

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    /**
      Email search → map auth.users → profile IDs
     */
    let userIdsFromEmail = [];

    if (search) {
      const { data: authUsers, error } =
        await supabase.auth.admin.listUsers({ perPage: 1000 });

      if (!error) {
        userIdsFromEmail = authUsers.users
          .filter(u =>
            u.email?.toLowerCase().includes(search.toLowerCase())
          )
          .map(u => u.id);
      }
    }

    /**
      Base query
     */
    let query = supabase
      .from("profiles")
      .select(
        `
        id,
        user_id,
        first_name,
        last_name,
        phone_number,
        is_admin,
        is_suspended,
        deleted_at,
        created_at
        `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    /**
      Status filter
     */
    if (status === "active") {
      query = query.eq("is_suspended", false).is("deleted_at", null);
    }

    if (status === "suspended") {
      query = query.eq("is_suspended", true).is("deleted_at", null);
    }

    if (status === "deleted") {
      query = query.not("deleted_at", "is", null);
    }

    /**
     Search filter (safe OR builder)
     */
    if (search) {
      const orFilters = [
        `first_name.ilike.%${search}%`,
        `last_name.ilike.%${search}%`,
        `phone_number.ilike.%${search}%`,
      ];

      if (userIdsFromEmail.length > 0) {
        orFilters.push(`id.in.(${userIdsFromEmail.join(",")})`);
      }

      query = query.or(orFilters.join(","));
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("Get users error:", error);
      return response.serverError(res, error.message);
    }

    return response.success(
      res,
      {
        users: data,
        pagination: {
          total: count,
          page,
          limit,
          total_pages: Math.ceil(count / limit),
        },
      },
      "Users fetched successfully"
    );
  } catch (err) {
    console.error("Get all users crash:", err);
    return response.serverError(res);
  }
};
