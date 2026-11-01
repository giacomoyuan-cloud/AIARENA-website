@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.pickandcase.assistant

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.unit.dp
import org.json.JSONObject

/** Shared role sizes with web; Android keeps its native ripple and focus behavior. */
@Composable
fun ArenaButton(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = RoundedCornerShape(NativeDesignTokens.radius_control.dp),
    colors: ButtonColors = ButtonDefaults.buttonColors(),
    elevation: ButtonElevation? = null, border: BorderStroke? = null,
    contentPadding: PaddingValues = PaddingValues(horizontal=16.dp, vertical=10.dp),
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) = Button(onClick, modifier.heightIn(min=NativeDesignTokens.size_touch.dp), enabled, shape, colors, elevation, border, contentPadding, interactionSource, content)

@Composable
fun ArenaOutlinedButton(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = RoundedCornerShape(NativeDesignTokens.radius_control.dp),
    colors: ButtonColors = ButtonDefaults.outlinedButtonColors(),
    elevation: ButtonElevation? = null, border: BorderStroke? = ButtonDefaults.outlinedButtonBorder(enabled),
    contentPadding: PaddingValues = PaddingValues(horizontal=16.dp, vertical=10.dp),
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) = OutlinedButton(onClick, modifier.heightIn(min=NativeDesignTokens.size_touch.dp), enabled, shape, colors, elevation, border, contentPadding, interactionSource, content)

@Composable
fun ArenaTextButton(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = RoundedCornerShape(NativeDesignTokens.radius_control.dp),
    colors: ButtonColors = ButtonDefaults.textButtonColors(),
    elevation: ButtonElevation? = null, border: BorderStroke? = null,
    contentPadding: PaddingValues = PaddingValues(horizontal=12.dp, vertical=8.dp),
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) = TextButton(onClick, modifier.heightIn(min=NativeDesignTokens.size_touch.dp), enabled, shape, colors, elevation, border, contentPadding, interactionSource, content)

fun nativeTaskState(task: JSONObject): String = when {
    task.optBoolean("queued") -> NativeDesignTokens.taskStates_queued
    task.optString("status")=="running" -> NativeDesignTokens.taskStates_running
    !task.optBoolean("enabled") -> NativeDesignTokens.taskStates_paused
    task.optString("status")=="failed" -> NativeDesignTokens.taskStates_failed
    task.optString("status")=="completed" -> NativeDesignTokens.taskStates_completed
    task.optString("status")=="cancelled" -> NativeDesignTokens.taskStates_cancelled
    else -> NativeDesignTokens.taskStates_scheduled
}

@Composable
fun ArenaSlider(
    value: Float, onValueChange: (Float) -> Unit,
    modifier: Modifier=Modifier, enabled:Boolean=true,
    valueRange: ClosedFloatingPointRange<Float> = 0f..1f, steps:Int=0,
    automatic:Boolean=false, showTicks:Boolean=true,
    onValueChangeFinished:(() -> Unit)?=null,
) {
    val accent=MaterialTheme.colorScheme.primary
    val gray=MaterialTheme.colorScheme.outlineVariant
    val surface=MaterialTheme.colorScheme.surface
    Slider(value,onValueChange,modifier.heightIn(min=NativeDesignTokens.size_touch.dp),enabled,
        valueRange=valueRange,steps=steps,onValueChangeFinished=onValueChangeFinished,
        thumb={Surface(Modifier.size(20.dp).alpha(if(automatic)0f else 1f),shape=CircleShape,color=surface,border=BorderStroke(1.dp,gray),shadowElevation=2.dp){}},
        track={state->Canvas(Modifier.fillMaxWidth().height(4.dp)){
            val progress=if(automatic)0f else ((state.value-valueRange.start)/(valueRange.endInclusive-valueRange.start)).coerceIn(0f,1f)
            val y=size.height/2
            drawLine(gray,Offset(0f,y),Offset(size.width,y),4.dp.toPx(),StrokeCap.Round)
            if(progress>0)drawLine(accent,Offset(0f,y),Offset(size.width*progress,y),4.dp.toPx(),StrokeCap.Round)
            if(showTicks){val ticks=if(steps<=9)maxOf(1,steps+1) else 4
                for(i in 0..ticks)drawCircle(if(i.toFloat()/ticks<=progress&&!automatic)surface.copy(alpha=.45f) else gray,1.6.dp.toPx(),Offset(size.width*i/ticks,y))
            }
        }},
    )
}
