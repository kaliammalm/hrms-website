# R8 rules for the RRD Group HRMS Capacitor app.
# Capacitor finds plugins and their methods by reflection, so they must keep their names.

# Capacitor core and the bridge between the WebView and native code
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}
-keep class com.capacitorjs.plugins.** { *; }

# Cordova compatibility layer (capacitor-cordova-android-plugins)
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**

# JavaScript interfaces exposed to the WebView
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# The app's own activity
-keep class com.rrdgroup.hrms.** { *; }

# Keep line numbers so crash reports point at real lines; hide source file names
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile
