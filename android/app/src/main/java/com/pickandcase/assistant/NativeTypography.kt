package com.pickandcase.assistant

import android.content.Context
import android.graphics.Typeface
import android.graphics.fonts.Font
import android.graphics.fonts.FontFamily
import android.graphics.fonts.FontStyle
import android.os.Build
import java.nio.ByteBuffer
import androidx.annotation.RequiresApi
import androidx.compose.material3.Typography
import androidx.compose.ui.text.font.FontFamily as ComposeFontFamily

/** The same Inter-first / Noto Sans SC fallback used by every web surface. */
object NativeTypography {
    @Volatile private var cached: Typeface? = null

    fun typeface(context: Context): Typeface = cached ?: synchronized(this) {
        cached ?: (if (Build.VERSION.SDK_INT >= 29) variableFamily(context)
            else context.resources.getFont(R.font.modern_font)).also { cached = it }
    }

    @RequiresApi(29)
    private fun variableFamily(context: Context): Typeface {
        fun family(resource: Int, optical: Boolean): FontFamily {
            // Share one compressed-resource buffer across every weight (API 29+).
            val source = context.resources.openRawResource(resource).use { input ->
                ByteBuffer.allocateDirect(input.available()).apply {
                    val chunk = ByteArray(8192)
                    while (true) {
                        val count = input.read(chunk)
                        if (count < 0) break
                        put(chunk, 0, count)
                    }
                    rewind()
                }
            }
            fun font(weight: Int): Font = Font.Builder(source)
                .setWeight(weight)
                .setSlant(FontStyle.FONT_SLANT_UPRIGHT)
                .setFontVariationSettings("'wght' $weight" + if (optical) ", 'opsz' 14" else "")
                .build()
            val builder = FontFamily.Builder(font(400))
            for (weight in listOf(500, 600, 650, 700, 900)) builder.addFont(font(weight))
            return builder.build()
        }
        return Typeface.CustomFallbackBuilder(family(R.font.inter, true))
            .addCustomFallback(family(R.font.noto_sans_sc, false))
            .setStyle(FontStyle(400, FontStyle.FONT_SLANT_UPRIGHT))
            .build()
    }

    fun typography(context: Context): Typography {
        val family = ComposeFontFamily(typeface(context))
        val base = Typography()
        return Typography(
            displayLarge = base.displayLarge.copy(fontFamily = family),
            displayMedium = base.displayMedium.copy(fontFamily = family),
            displaySmall = base.displaySmall.copy(fontFamily = family),
            headlineLarge = base.headlineLarge.copy(fontFamily = family),
            headlineMedium = base.headlineMedium.copy(fontFamily = family),
            headlineSmall = base.headlineSmall.copy(fontFamily = family),
            titleLarge = base.titleLarge.copy(fontFamily = family),
            titleMedium = base.titleMedium.copy(fontFamily = family),
            titleSmall = base.titleSmall.copy(fontFamily = family),
            bodyLarge = base.bodyLarge.copy(fontFamily = family),
            bodyMedium = base.bodyMedium.copy(fontFamily = family),
            bodySmall = base.bodySmall.copy(fontFamily = family),
            labelLarge = base.labelLarge.copy(fontFamily = family),
            labelMedium = base.labelMedium.copy(fontFamily = family),
            labelSmall = base.labelSmall.copy(fontFamily = family),
        )
    }
}
