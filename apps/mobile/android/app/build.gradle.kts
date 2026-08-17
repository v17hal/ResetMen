import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    id("com.google.gms.google-services")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

/**
 * Release signing, read from a file that is never committed.
 *
 * `android/key.properties` is gitignored, and so is the keystore it points at. Losing that
 * keystore means the app can never be updated on Play under the same listing — Google will
 * not accept a differently-signed APK — so it belongs in the client's password manager, not
 * in this repository.
 *
 * When the file is absent (every developer machine, and CI on a pull request) the release
 * build falls back to debug keys so `flutter build apk --release` still works. A build
 * signed that way is fine for testing and is rejected by Play, which is the correct
 * outcome — it cannot be shipped by accident.
 */
val keystoreProperties = Properties().apply {
    val file = rootProject.file("key.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val hasReleaseKeystore = keystoreProperties.getProperty("storeFile") != null

android {
    // Matches the package of MainActivity.kt. The manifest resolves `.MainActivity`
    // against this, so changing it without moving the source produces an APK that
    // installs and then crashes on launch with ClassNotFoundException.
    namespace = "app.reset.reset_app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
        // flutter_local_notifications schedules with java.time, which does not exist below
        // API 26. Desugaring backports it rather than forcing minSdk up and cutting off
        // older phones — which in this market is a meaningful share of customers.
        isCoreLibraryDesugaringEnabled = true
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        // Cannot change after the first Play upload. `app.reset.app` is the client's
        // domain reversed, which is what Play expects to be able to verify later.
        applicationId = "app.reset.app"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }

            // Shrink and obfuscate. The keep rules in proguard-rules.pro cover the plugins
            // that resolve classes by name at runtime and would otherwise be stripped.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
}

dependencies {
    // Required by isCoreLibraryDesugaringEnabled above. Version is tied to the AGP in
    // settings.gradle.kts — bumping one without the other fails at this exact task.
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}

flutter {
    source = "../.."
}
