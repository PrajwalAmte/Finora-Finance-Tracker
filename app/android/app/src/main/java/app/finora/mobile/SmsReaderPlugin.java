package app.finora.mobile;

import android.Manifest;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Telephony;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Reads inbox SMS on request so the app can find bank/UPI transactions. Messages are returned to
 * the WebView, parsed in memory and discarded; nothing here stores or sends them anywhere.
 * Only bodies from senders that look like bank/business short codes are returned.
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = { @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS }) }
)
public class SmsReaderPlugin extends Plugin {

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("sms") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            checkPermission(call);
            return;
        }
        requestPermissionForAlias("sms", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        checkPermission(call);
    }

    @PluginMethod
    public void read(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("SMS permission not granted");
            return;
        }
        long since = call.getLong("since", 0L);
        int limit = Math.max(1, Math.min(call.getInt("limit", 500), 2000));

        JSArray messages = new JSArray();
        Uri inbox = Telephony.Sms.Inbox.CONTENT_URI;
        String[] projection = { Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE };
        try (Cursor c = getContext().getContentResolver().query(
                inbox, projection, Telephony.Sms.DATE + " > ?", new String[] { String.valueOf(since) },
                Telephony.Sms.DATE + " DESC")) {
            if (c != null) {
                while (c.moveToNext() && messages.length() < limit) {
                    String address = c.getString(1);
                    // Banks and payment apps send from alphanumeric sender IDs like "AD-HDFCBK";
                    // personal conversations come from phone numbers and are skipped.
                    if (address == null || address.replaceAll("[^A-Za-z]", "").length() < 3) continue;
                    JSObject m = new JSObject();
                    m.put("id", c.getString(0));
                    m.put("address", address);
                    m.put("body", c.getString(2));
                    m.put("date", c.getLong(3));
                    messages.put(m);
                }
            }
        } catch (SecurityException e) {
            call.reject("SMS permission not granted", e);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("messages", messages);
        call.resolve(ret);
    }
}
