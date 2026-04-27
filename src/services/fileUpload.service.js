import { randomUUID } from 'crypto';
import { getCloudinary } from '../config/cloudinary.js';
import { getSupabaseAdmin } from '../config/supabase.js';
import { getFileExtension } from '../utils/fileValidator.js';

const BUCKET_NAME = 'car-documents';
const CLOUDINARY_FOLDER = 'ladipo-products';

/**
 * Uploads a single file to Supabase Storage
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} filename - Original filename
 * @param {string} mimetype - File MIME type
 * @param {string} userId - User ID
 * @param {string} carSlug - Car slug (optional, for updates)
 * @returns {Promise<string>} - Public URL of uploaded file
 */
export const uploadFile = async (fileBuffer, filename, mimetype, userId, carSlug = null) => {
  const supabaseAdmin = getSupabaseAdmin();
  
  // Generate unique filename: UUID + original extension
  const extension = getFileExtension(filename);
  const uniqueFilename = `${randomUUID()}${extension}`;
  
  // Build file path: {user_id}/{car_slug or 'temp'}/{filename}
  const folderPath = carSlug ? `${userId}/${carSlug}` : `${userId}/temp`;
  const filePath = `${folderPath}/${uniqueFilename}`;
  
  // Upload file to Supabase Storage with correct MIME type
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .upload(filePath, fileBuffer, {
      contentType: mimetype, // Use actual MIME type instead of hardcoded value
      upsert: false
    });
  
  if (error) {
    throw new Error(`Failed to upload file: ${error.message}`);
  }
  
  // Get public URL
  const { data: urlData } = supabaseAdmin.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filePath);
  
  if (!urlData?.publicUrl) {
    throw new Error('Failed to get public URL for uploaded file');
  }
  
  return urlData.publicUrl;
};

/**
 * Uploads multiple files to Supabase Storage
 * @param {Array<Object>} files - Array of file objects with buffer, originalname, and mimetype
 * @param {string} userId - User ID
 * @param {string} carSlug - Car slug (optional, for updates)
 * @returns {Promise<Array<string>>} - Array of public URLs
 */
export const uploadFiles = async (files, userId, carSlug = null) => {
  const uploadPromises = files.map(file => 
    uploadFile(file.buffer, file.originalname, file.mimetype, userId, carSlug)
  );
  
  return Promise.all(uploadPromises);
};

/**
 * Deletes a file from Supabase Storage
 * @param {string} fileUrl - Public URL of the file
 * @returns {Promise<void>}
 */
export const deleteFile = async (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== 'string') {
    return; // No file to delete
  }
  
  try {
    const supabaseAdmin = getSupabaseAdmin();
    
    // Extract file path from URL
    // Supabase Storage URLs format: {SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{PATH}
    const urlParts = fileUrl.split('/storage/v1/object/public/');
    if (urlParts.length !== 2) {
      // Not a Supabase Storage URL, skip deletion
      return;
    }
    
    const pathParts = urlParts[1].split('/');
    if (pathParts[0] !== BUCKET_NAME) {
      // Not from our bucket, skip deletion
      return;
    }
    
    const filePath = pathParts.slice(1).join('/');
    
    const { error } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .remove([filePath]);
    
    if (error) {
      console.error(`Failed to delete file ${filePath}:`, error.message);
      // Don't throw - file deletion failure shouldn't break the request
    }
  } catch (error) {
    console.error(`Error deleting file ${fileUrl}:`, error.message);
    // Don't throw - file deletion failure shouldn't break the request
  }
};

/**
 * Deletes multiple files from Supabase Storage
 * @param {Array<string>} fileUrls - Array of public URLs
 * @returns {Promise<void>}
 */
export const deleteFiles = async (fileUrls) => {
  if (!fileUrls || !Array.isArray(fileUrls)) {
    return;
  }
  
  const deletePromises = fileUrls.map(url => deleteFile(url));
  await Promise.all(deletePromises);
};

/**
 * Moves temporary files to car-specific folder
 * @param {Array<string>} tempUrls - Array of temporary file URLs
 * @param {string} userId - User ID
 * @param {string} carSlug - Car slug
 * @returns {Promise<Array<string>>} - Array of new public URLs
 */
export const moveFilesToCarFolder = async (tempUrls, userId, carSlug) => {
  if (!tempUrls || tempUrls.length === 0) {
    return [];
  }
  
  const supabaseAdmin = getSupabaseAdmin();
  const newUrls = [];
  
  for (const tempUrl of tempUrls) {
    try {
      // Extract file path from temporary URL
      const urlParts = tempUrl.split('/storage/v1/object/public/');
      if (urlParts.length !== 2) continue;
      
      const pathParts = urlParts[1].split('/');
      if (pathParts[0] !== BUCKET_NAME || pathParts[1] !== userId || pathParts[2] !== 'temp') {
        // Not a temporary file from our system, keep original URL
        newUrls.push(tempUrl);
        continue;
      }
      
      const filename = pathParts.slice(3).join('/');
      const oldPath = `${userId}/temp/${filename}`;
      const newPath = `${userId}/${carSlug}/${filename}`;
      
      // Copy file to new location
      const { data: copyData, error: copyError } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .copy(oldPath, newPath);
      
      if (copyError) {
        console.error(`Failed to move file ${oldPath}:`, copyError.message);
        newUrls.push(tempUrl); // Keep original URL on error
        continue;
      }
      
      // Get new public URL
      const { data: urlData } = supabaseAdmin.storage
        .from(BUCKET_NAME)
        .getPublicUrl(newPath);
      
      if (urlData?.publicUrl) {
        newUrls.push(urlData.publicUrl);
        
        // Delete old file
        await deleteFile(tempUrl);
      } else {
        newUrls.push(tempUrl); // Keep original URL on error
      }
    } catch (error) {
      console.error(`Error moving file ${tempUrl}:`, error.message);
      newUrls.push(tempUrl); // Keep original URL on error
    }
  }
  
  return newUrls;
};

/**
 * Upload a product image to Cloudinary.
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} filename - Original filename
 * @param {string} mimetype - File MIME type
 * @returns {Promise<string>} - Secure Cloudinary URL
 */
export const uploadToCloudinary = async (fileBuffer, filename, mimetype) => {
  const cloudinary = getCloudinary();
  void mimetype;
  const extension = getFileExtension(filename);
  const publicId = `${randomUUID()}${extension ? extension.replace('.', '-') : ''}`;

  const result = await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        public_id: publicId,
        resource_type: 'image',
        overwrite: false,
        unique_filename: false,
        use_filename: false,
        invalidate: false,
      },
      (error, uploadResult) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(uploadResult);
      },
    );

    uploadStream.end(fileBuffer);
  });

  if (!result?.secure_url) {
    throw new Error('Failed to upload image to Cloudinary');
  }

  return result.secure_url;
};

/**
 * Deletes a Cloudinary asset by URL.
 * @param {string} fileUrl - Cloudinary secure_url
 * @returns {Promise<void>}
 */
export const deleteFromCloudinary = async (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== 'string' || !fileUrl.includes('res.cloudinary.com')) {
    return;
  }

  try {
    const cloudinary = getCloudinary();
    const parsed = new URL(fileUrl);
    const uploadIndex = parsed.pathname.indexOf('/upload/');
    if (uploadIndex === -1) return;

    let publicIdPath = parsed.pathname.slice(uploadIndex + '/upload/'.length);
    publicIdPath = publicIdPath.replace(/^v\d+\//, '');
    publicIdPath = publicIdPath.replace(/\.[^.\/]+$/, '');
    if (!publicIdPath) return;

    await cloudinary.uploader.destroy(publicIdPath, {
      resource_type: 'image',
      invalidate: true,
    });
  } catch (error) {
    console.error(`Failed to delete Cloudinary asset ${fileUrl}:`, error.message);
  }
};
