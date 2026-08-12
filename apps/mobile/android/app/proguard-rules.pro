# Keep rules for the release build.
#
# R8 strips anything it cannot see referenced, and several plugins here are reached
# reflectively — the symptom is a release APK that crashes on a screen the debug build
# runs fine, which is the worst kind of bug to find after a Play rollout.

# Flutter's embedding, referenced from the generated Java host.
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.embedding.** { *; }

# Flutter's embedding compiles in a PlayStoreDeferredComponentManager that references the
# Play Core split-install API. This app has no deferred components and does not bundle Play
# Core, so those classes genuinely are not there — R8 treats the dangling references as a
# hard error and the release build fails while debug is fine. The code is unreachable, so
# the warnings are suppressed rather than the dependency added.
-dontwarn com.google.android.play.core.**
-dontwarn io.flutter.embedding.engine.deferredcomponents.**

# Razorpay resolves its payment classes by name and uses annotations at runtime.
-keep class com.razorpay.** { *; }
-keepclassmembers class * {
    @com.razorpay.* <methods>;
}
# Razorpay ships optional ProGuard-annotated helpers that reference classes it does not
# bundle. Without this the build fails on warnings for code that is never executed.
-dontwarn com.razorpay.**
-optimizations !method/inlining/*

# flutter_secure_storage relies on the AndroidX security library, which loads its
# crypto providers reflectively.
-keep class androidx.security.crypto.** { *; }
-dontwarn androidx.security.crypto.**

# Kotlin metadata, used by plugin channels to resolve method signatures.
-keep class kotlin.Metadata { *; }

# Keep the line numbers so a crash report from Play is readable, while still obfuscating
# the class names. Without SourceFile the stack traces are unusable.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
