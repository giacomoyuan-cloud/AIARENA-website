package com.pickandcase.assistant

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider

/** Every business screen is drawn by native Compose/Android views. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val model =
            ViewModelProvider(
                this,
                object : ViewModelProvider.Factory {
                    override fun <T : ViewModel> create(modelClass: Class<T>): T {
                        val api =
                            NativeApi(
                                if (BuildConfig.DEBUG)
                                    NativeTestHooks.baseUrl ?: BuildConfig.API_URL
                                else BuildConfig.API_URL
                            )
                        @Suppress("UNCHECKED_CAST")
                        return AssistantViewModel(application, api) as T
                    }
                },
            )[AssistantViewModel::class.java]
        setContent { AssistantApp(model) }
    }
}

// Instrumentation may inject a synthetic server in debug builds; release always uses API_URL.
object NativeTestHooks {
    @Volatile var baseUrl: String? = null
}
