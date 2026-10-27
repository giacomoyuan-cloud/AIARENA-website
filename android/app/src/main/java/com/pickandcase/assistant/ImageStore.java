package com.pickandcase.assistant;

import android.content.ContentValues;
import android.content.Context;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.util.UUID;

final class ImageStore {
    static final int MAX_BYTES = 32 * 1024 * 1024;
    static final class Image {
        final File file; final String mime; final String name;
        Image(File file, String mime, String name) { this.file=file; this.mime=mime; this.name=name; }
    }
    private static File directory(Context context) throws IOException {
        File dir = new File(context.getCacheDir(), "shared-images");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("无法创建图片缓存");
        return dir;
    }
    static void cleanOld(Context context) {
        File[] files = new File(context.getCacheDir(), "shared-images").listFiles();
        if (files != null) for (File file : files) {
            if (file.isFile() && System.currentTimeMillis() - file.lastModified() > 86400000L) file.delete();
        }
    }
    static Image decode(Context context, String base64, String mime) throws IOException {
        String ext = switch (mime) { case "image/png" -> "png"; case "image/jpeg" -> "jpg"; case "image/webp" -> "webp"; default -> throw new IOException("不支持的图片格式"); };
        if (base64 == null || base64.length() > (MAX_BYTES * 4L / 3L + 8)) throw new IOException("图片超过 32 MB，请下载后分享");
        byte[] data;
        try { data=Base64.decode(base64, Base64.DEFAULT); } catch (IllegalArgumentException e) { throw new IOException("图片数据无效"); }
        if (data.length == 0 || data.length > MAX_BYTES) throw new IOException("图片大小无效");
        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds=true;
        BitmapFactory.decodeByteArray(data, 0, data.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || !mime.equals(bounds.outMimeType)) throw new IOException("图片数据无效");
        String name="AI-"+UUID.randomUUID()+"."+ext;
        File file=new File(directory(context), name);
        try (FileOutputStream stream=new FileOutputStream(file)) { stream.write(data); }
        return new Image(file,mime,name);
    }
    static Uri shareUri(Context context, Image image) { return FileProvider.getUriForFile(context, context.getPackageName()+".files", image.file); }
    static void copy(Context context, Image image, Uri destination) throws IOException {
        try (OutputStream stream=context.getContentResolver().openOutputStream(destination)) {
            if (stream == null) throw new IOException("无法写入图片");
            Files.copy(image.file.toPath(), stream);
        }
    }
    static Uri save(Context context, Image image) throws IOException {
        if (Build.VERSION.SDK_INT < 29) throw new IOException("请使用系统文件选择器保存");
        ContentValues values=new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME,image.name);
        values.put(MediaStore.Images.Media.MIME_TYPE,image.mime);
        values.put(MediaStore.Images.Media.RELATIVE_PATH,Environment.DIRECTORY_PICTURES+"/AI Assistant");
        values.put(MediaStore.Images.Media.IS_PENDING,1);
        Uri uri=context.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);
        if (uri == null) throw new IOException("无法保存图片");
        try {
            copy(context,image,uri); values.clear(); values.put(MediaStore.Images.Media.IS_PENDING,0);
            context.getContentResolver().update(uri,values,null,null); return uri;
        } catch (Exception e) { context.getContentResolver().delete(uri,null,null); throw new IOException("保存失败，请重试",e); }
    }
    private ImageStore() {}
}
