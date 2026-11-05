import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { api, clearToken, saveToken } from "./src/services/api";
import { uiEvents } from "./src/events/event-bus";

type Role = "ADMIN" | "CUSTOMER";
type User = { id: string; email: string; role: Role; fullName: string };
type Accommodation = {
  id: string;
  name: string;
  category: string;
  description: string;
  capacity_adults: number;
  capacity_children: number;
  day_price: number;
  night_price: number;
  image_url?: string;
};
type Booking = {
  id: string;
  reference: string;
  status: string;
  kind: string;
  total: number;
  accommodation_name?: string;
  start_at: string;
  end_at: string;
};
type Payment = {
  id: string;
  booking_id: string;
  booking_reference?: string;
  customer_name?: string;
  method: string;
  amount: number;
  status: string;
  reference_number?: string;
};
const C = {
  ocean: "#087E8B",
  teal: "#13A89E",
  sand: "#F5F0E6",
  white: "#FFFFFF",
  navy: "#12343B",
  orange: "#F4A261",
  muted: "#6D8587",
  line: "#E5ECE9",
  red: "#B94A48",
  green: "#23836F",
};
const money = (v: number) =>
  `₱${Number(v || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: "email-address" | "phone-pad" | "default";
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9AAEAC"
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
        style={s.input}
      />
    </View>
  );
}
function Button({
  title,
  onPress,
  secondary,
  disabled,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.buttonSecondary,
        disabled && { opacity: 0.5 },
        pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] },
      ]}
    >
      <Text style={[s.buttonText, secondary && { color: C.ocean }]}>
        {title}
      </Text>
    </Pressable>
  );
}
function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={s.heading}>{title}</Text>
      {!!subtitle && <Text style={s.subheading}>{subtitle}</Text>}
    </View>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("Home");
  const [items, setItems] = useState<Accommodation[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const categories = [
    "All",
    "Cottages",
    "Rooms",
    "Day-use Packages",
    "Overnight Packages",
  ];
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [dashboard, setDashboard] = useState<Record<string, number>>({});
  const [payBooking, setPayBooking] = useState<Booking | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payReference, setPayReference] = useState("");
  const [payMethod, setPayMethod] = useState<
    "GCASH" | "BANK_TRANSFER" | "CASH_ON_ARRIVAL"
  >("GCASH");
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Accommodation | null>(null);
  const [kind, setKind] = useState<"DAY_USE" | "OVERNIGHT">("DAY_USE");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [adults, setAdults] = useState("2");
  const [children, setChildren] = useState("0");
  const [special, setSpecial] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const { user } = await api<{ user: User }>("/auth/me");
        setUser(user);
      } catch {
      } finally {
        setBooting(false);
      }
    })();
  }, []);
  useEffect(() => {
    const off = uiEvents.on("loginSucceeded", () => {
      setTab("Home");
    });

    return off;
  }, []);
  const load = async () => {
    if (!user) return;
    setRefreshing(true);
    try {
      if (user.role === "CUSTOMER") {
        const [a, b, p] = await Promise.all([
          api<{ data: Accommodation[] }>("/accommodations"),
          api<{ data: Booking[] }>("/bookings/mine"),
          api<{ data: Payment[] }>("/payments/mine"),
        ]);
        setItems(a.data);
        setBookings(b.data);
        setPayments(p.data);
        uiEvents.emit("catalogLoaded", { count: a.data.length });
      } else {
        const [d, b, p, a] = await Promise.all([
          api<{ data: Record<string, number> }>("/admin/dashboard"),
          api<{ data: Booking[] }>("/admin/bookings"),
          api<{ data: Payment[] }>("/admin/payments"),
          api<{ data: Accommodation[] }>("/accommodations"),
        ]);
        setDashboard(d.data);
        setBookings(b.data);
        setPayments(p.data);
        setItems(a.data);
      }
    } catch (e) {
      Alert.alert("Unable to refresh", (e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => {
    load();
  }, [user]);
  const auth = async () => {
    setBusy(true);
    try {
      if (mode === "register") {
        await api("/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, fullName, phone }),
        });
        Alert.alert("Account created", "You can now sign in.");
        setMode("login");
      } else {
        const result = await api<{ token: string; user: User }>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        await saveToken(result.token);
        setUser(result.user);
        uiEvents.emit("loginSucceeded", { userId: result.user.id });
      }
    } catch (e) {
      Alert.alert(
        mode === "login" ? "Sign in failed" : "Registration failed",
        (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    await clearToken();
    setUser(null);
    setItems([]);
    setBookings([]);
    setSelected(null);
    setMode("login");
  };
  const createBooking = async () => {
    if (!selected || !startAt || !endAt) {
      Alert.alert(
        "Complete the details",
        "Enter start and end date/time in ISO format, for example 2026-12-20T09:00:00.000Z.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ data: Booking }>("/bookings", {
        method: "POST",
        body: JSON.stringify({
          accommodationId: selected.id,
          kind,
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
          adults: Number(adults),
          children: Number(children),
          specialRequest: special,
        }),
      });
      uiEvents.emit("bookingSubmitted", { bookingId: result.data.id });
      Alert.alert(
        "Reservation submitted",
        `Reference: ${result.data.reference}\nStatus: Pending admin approval.`,
      );
      setSelected(null);
      setTab("My Bookings");
      await load();
    } catch (e) {
      Alert.alert("Could not submit booking", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const updateBooking = async (
    id: string,
    status: "CONFIRMED" | "REJECTED",
  ) => {
    try {
      await api(`/admin/bookings/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      Alert.alert("Update failed", (e as Error).message);
    }
  };
  const submitPayment = async () => {
    if (!payBooking || !Number(payAmount)) {
      Alert.alert("Enter payment amount", "Please enter a valid amount.");
      return;
    }
    setBusy(true);
    try {
      await api("/payments", {
        method: "POST",
        body: JSON.stringify({
          bookingId: payBooking.id,
          method: payMethod,
          amount: Number(payAmount),
          referenceNumber: payReference || undefined,
        }),
      });
      Alert.alert(
        "Payment submitted",
        "Your payment is pending manual verification by the resort.",
      );
      setPayBooking(null);
      setPayAmount("");
      setPayReference("");
      await load();
    } catch (e) {
      Alert.alert("Payment not submitted", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const updatePayment = async (id: string, status: "VERIFIED" | "REJECTED") => {
    try {
      await api(`/admin/payments/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      Alert.alert("Payment update failed", (e as Error).message);
    }
  };
  const title = useMemo(
    () => (user?.role === "ADMIN" ? "Resort Console" : "Tide & Haven"),
    [user],
  );
  const filteredItems =
    selectedCategory === "All"
      ? items
      : items.filter((item) => item.category === selectedCategory);
  if (booting)
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator size="large" color={C.ocean} />
        <Text style={s.subheading}>Preparing your resort experience…</Text>
      </SafeAreaView>
    );
  if (!user)
    return (
      <SafeAreaView style={s.safe}>
        <ExpoStatusBar style="dark" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={s.authWrap}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.brandMark}>
              <Text style={{ fontSize: 28 }}>🌴</Text>
            </View>
            <Text style={s.brand}>TIDE & HAVEN</Text>
            <Text style={s.brandSub}>A little closer to paradise.</Text>
            <View style={s.authCard}>
              <Text style={s.heading}>
                {mode === "login" ? "Welcome back" : "Create your account"}
              </Text>
              <Text style={s.subheading}>
                {mode === "login"
                  ? "Sign in to plan your next escape."
                  : "Join us and discover your resort stay."}
              </Text>
              {mode === "register" && (
                <>
                  <Field
                    label="Full name"
                    value={fullName}
                    onChangeText={setFullName}
                    placeholder="Your full name"
                  />
                  <Field
                    label="Phone number"
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="09XX XXX XXXX"
                    keyboardType="phone-pad"
                  />
                </>
              )}
              <Field
                label="Email address"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="At least 8 characters"
                secureTextEntry
              />
              <Button
                title={
                  busy
                    ? "Please wait…"
                    : mode === "login"
                      ? "Sign in"
                      : "Create account"
                }
                onPress={auth}
                disabled={busy}
              />
              <Pressable
                onPress={() => setMode(mode === "login" ? "register" : "login")}
                style={{ padding: 14 }}
              >
                <Text style={s.link}>
                  {mode === "login"
                    ? "New here? Create an account"
                    : "Already registered? Sign in"}
                </Text>
              </Pressable>
            </View>
            <Text style={s.footnote}>
              Secure reservations • Thoughtful stays • Tropical memories
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={s.safe}>
      <ExpoStatusBar style="dark" />
      <View style={s.topbar}>
        <View>
          <Text style={s.topBrand}>{title}</Text>
          <Text style={s.topCaption}>{user.fullName}</Text>
        </View>
        <Pressable onPress={logout} style={s.avatar}>
          <Text style={{ color: C.ocean, fontWeight: "800" }}>
            {user.fullName.slice(0, 1).toUpperCase()}
          </Text>
        </Pressable>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={load}
            tintColor={C.ocean}
          />
        }
      >
        {user.role === "CUSTOMER" && tab === "Home" && (
          <>
            <View style={s.hero}>
              <Text style={s.heroEyebrow}>YOUR TROPICAL ESCAPE</Text>
              <Text style={s.heroTitle}>Find your{"\n"}moment by the sea.</Text>
              <Text style={s.heroText}>
                Slow mornings, sunny afternoons, and stays worth remembering.
              </Text>
              <Pressable
                style={s.heroPill}
                onPress={() => {
                  setSelectedCategory("All");
                  setTab("Explore");
                }}
              >
                <Text style={s.heroPillText}>Explore the resort →</Text>
              </Pressable>
            </View>
            <Header
              title="A stay for every kind of day"
              subtitle="Thoughtfully selected spaces and experiences."
            />
            <View style={s.quickGrid}>
              {[
                "Cottages",
                "Rooms",
                "Day-use Packages",
                "Overnight Packages",
              ].map((x, i) => (
                <Pressable
                  key={x}
                  onPress={() => {
                    setSelectedCategory(x);
                    setTab("Explore");
                  }}
                  style={s.quick}
                >
                  <Text style={{ fontSize: 22 }}>
                    {["🏡", "🛏️", "☀️", "🌙"][i]}
                  </Text>
                  <Text style={s.quickText}>{x}</Text>
                </Pressable>
              ))}
            </View>
            <Header title="Guest favorites" />
            <AccommodationList
              items={items.slice(0, 3)}
              onSelect={setSelected}
            />
          </>
        )}
        {user.role === "CUSTOMER" && tab === "Explore" && (
          <>
            <Header
              title="Explore the Resort"
              subtitle="Find your perfect cottage, room, or resort package."
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 18 }}
            >
              {categories.map((category) => (
                <Pressable
                  key={category}
                  onPress={() => setSelectedCategory(category)}
                  style={{
                    backgroundColor:
                      selectedCategory === category ? C.ocean : C.white,
                    paddingHorizontal: 16,
                    paddingVertical: 11,
                    borderRadius: 25,
                    marginRight: 8,
                  }}
                >
                  <Text
                    style={{
                      color: selectedCategory === category ? C.white : C.navy,
                      fontWeight: "800",
                      fontSize: 12,
                    }}
                  >
                    {category}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={s.meta}>
              {filteredItems.length} listings available
            </Text>

            <AccommodationList items={filteredItems} onSelect={setSelected} />
          </>
        )}
        {user.role === "CUSTOMER" && tab === "My Bookings" && (
          <>
            <Header
              title="My bookings"
              subtitle="Your reservations, all in one place."
            />
            {bookings.length === 0 ? (
              <Empty text="No bookings yet. Your next escape is waiting." />
            ) : (
              bookings.map((b) => (
                <View key={b.id} style={s.bookingCard}>
                  <View style={s.rowBetween}>
                    <Text style={s.cardTitle}>
                      {b.accommodation_name ?? b.reference}
                    </Text>
                    <StatusPill status={b.status} />
                  </View>
                  <Text style={s.meta}>
                    {b.reference} • {b.kind.replace("_", " ")}
                  </Text>
                  <Text style={s.meta}>
                    {new Date(b.start_at).toLocaleString()} –{" "}
                    {new Date(b.end_at).toLocaleString()}
                  </Text>
                  <Text style={s.price}>{money(b.total)}</Text>
                </View>
              ))
            )}
          </>
        )}
        {user.role === "CUSTOMER" && tab === "Payments" && (
          <>
            <Header
              title="Payments"
              subtitle="Submit payment details for manual verification."
            />
            {bookings
              .filter((b) => ["PENDING", "CONFIRMED"].includes(b.status))
              .map((b) => (
                <View key={b.id} style={s.bookingCard}>
                  <Text style={s.cardTitle}>
                    {b.accommodation_name ?? b.reference}
                  </Text>
                  <Text style={s.meta}>
                    {b.reference} • Balance starts at {money(b.total)}
                  </Text>
                  <Button
                    title="Submit payment"
                    onPress={() => {
                      setPayBooking(b);
                      setPayAmount(String(b.total));
                    }}
                  />
                </View>
              ))}
            <Header title="Payment history" />
            {payments.length === 0 ? (
              <Empty text="No payment submissions yet." />
            ) : (
              payments.map((p) => (
                <View key={p.id} style={s.bookingCard}>
                  <View style={s.rowBetween}>
                    <Text style={s.cardTitle}>{money(p.amount)}</Text>
                    <StatusPill status={p.status} />
                  </View>
                  <Text style={s.meta}>
                    {p.method.replace("_", " ")} •{" "}
                    {p.reference_number ?? "No reference supplied"}
                  </Text>
                </View>
              ))
            )}
          </>
        )}
        {user.role === "CUSTOMER" && tab === "Profile" && (
          <>
            <Header title="Your profile" />
            <View style={s.bookingCard}>
              <Text style={s.cardTitle}>{user.fullName}</Text>
              <Text style={s.meta}>{user.email}</Text>
              <Text style={s.meta}>Customer account</Text>
              <Button title="Sign out" onPress={logout} secondary />
            </View>
          </>
        )}
        {user.role === "ADMIN" && tab === "Home" && (
          <>
            <Header
              title="Good day, Admin"
              subtitle="Here’s what’s happening at your resort."
            />
            <View style={s.stats}>
              {[
                ["Total bookings", dashboard.totalBookings ?? 0],
                ["Pending", dashboard.pendingBookings ?? 0],
                ["Customers", dashboard.customers ?? 0],
                ["Verified revenue", money(dashboard.verifiedRevenue ?? 0)],
              ].map(([k, v]) => (
                <View key={String(k)} style={s.stat}>
                  <Text style={s.statValue}>{v}</Text>
                  <Text style={s.statLabel}>{k}</Text>
                </View>
              ))}
            </View>
            <Header title="Recent reservations" />
            <AdminBookings
              bookings={bookings.slice(0, 5)}
              onUpdate={updateBooking}
            />
          </>
        )}
        {user.role === "ADMIN" && tab === "Payments" && (
          <>
            <Header
              title="Payment verification"
              subtitle="Review customer submissions. Uploading a reference does not mean a payment is verified."
            />
            {payments.length === 0 ? (
              <Empty text="No payment submissions yet." />
            ) : (
              payments.map((p) => (
                <View key={p.id} style={s.bookingCard}>
                  <View style={s.rowBetween}>
                    <Text style={s.cardTitle}>{money(p.amount)}</Text>
                    <StatusPill status={p.status} />
                  </View>
                  <Text style={s.meta}>
                    {p.customer_name ?? "Customer"} •{" "}
                    {p.booking_reference ?? p.booking_id}
                  </Text>
                  <Text style={s.meta}>
                    {p.method} • {p.reference_number ?? "No reference"}
                  </Text>
                  {p.status === "SUBMITTED" && (
                    <View style={s.row}>
                      <View style={{ flex: 1 }}>
                        <Button
                          title="Verify"
                          onPress={() => updatePayment(p.id, "VERIFIED")}
                        />
                      </View>
                      <View style={{ width: 10 }} />
                      <View style={{ flex: 1 }}>
                        <Button
                          title="Reject"
                          secondary
                          onPress={() => updatePayment(p.id, "REJECTED")}
                        />
                      </View>
                    </View>
                  )}
                </View>
              ))
            )}
          </>
        )}
        {user.role === "ADMIN" && tab === "Reservations" && (
          <>
            <Header
              title="Reservation management"
              subtitle="Review requests and update their status."
            />
            <AdminBookings bookings={bookings} onUpdate={updateBooking} />
          </>
        )}
        {user.role === "ADMIN" && tab === "Inventory" && (
          <>
            <Header
              title="Accommodation inventory"
              subtitle="Active listings customers can reserve."
            />
            <AccommodationList
              items={items}
              onSelect={() =>
                Alert.alert(
                  "Inventory",
                  "Accommodation editing is available through the secured API; a full editor screen is not included in this mobile build.",
                )
              }
            />
          </>
        )}
      </ScrollView>
      <View style={s.nav}>
        {(user.role === "ADMIN"
          ? ["Home", "Reservations", "Payments", "Inventory"]
          : ["Home", "Explore", "My Bookings", "Payments", "Profile"]
        ).map((x, i) => (
          <Pressable
            key={x}
            onPress={() => {
              setTab(x);
              uiEvents.emit("screenChanged", { screen: x });
            }}
            style={s.navItem}
          >
            <Text style={[s.navIcon, tab === x && { color: C.ocean }]}>
              {
                (user.role === "ADMIN"
                  ? ["▦", "▤", "₱", "⌂"]
                  : ["⌂", "◈", "▣", "₱", "○"])[i]
              }
            </Text>
            <Text
              style={[
                s.navText,
                tab === x && { color: C.ocean, fontWeight: "800" },
              ]}
            >
              {x}
            </Text>
          </Pressable>
        ))}
      </View>
      {selected && (
        <View style={s.modalShade}>
          <ScrollView style={s.modal} contentContainerStyle={{ padding: 20 }}>
            <Pressable onPress={() => setSelected(null)}>
              <Text style={s.close}>✕ Close</Text>
            </Pressable>
            <Text style={s.heading}>{selected.name}</Text>
            <Text style={s.subheading}>{selected.description}</Text>
            <Text style={s.meta}>
              Capacity: {selected.capacity_adults} adults •{" "}
              {selected.capacity_children} children
            </Text>
            <View style={s.toggleRow}>
              {(["DAY_USE", "OVERNIGHT"] as const).map((k) => (
                <Pressable
                  key={k}
                  onPress={() => setKind(k)}
                  style={[s.toggle, kind === k && s.toggleActive]}
                >
                  <Text
                    style={[s.toggleText, kind === k && { color: C.white }]}
                  >
                    {k === "DAY_USE" ? "Day use" : "Overnight"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.price}>
              {money(
                kind === "DAY_USE" ? selected.day_price : selected.night_price,
              )}{" "}
              {kind === "OVERNIGHT" ? "/ night" : "/ package"}
            </Text>
            <Field
              label={
                kind === "DAY_USE"
                  ? "Arrival date & time (ISO)"
                  : "Check-in (ISO)"
              }
              value={startAt}
              onChangeText={setStartAt}
              placeholder="2026-12-20T09:00:00.000Z"
            />
            <Field
              label={
                kind === "DAY_USE"
                  ? "Departure date & time (ISO)"
                  : "Check-out (ISO)"
              }
              value={endAt}
              onChangeText={setEndAt}
              placeholder="2026-12-20T17:00:00.000Z"
            />
            <Field
              label="Adults"
              value={adults}
              onChangeText={setAdults}
              placeholder="2"
              keyboardType="phone-pad"
            />
            <Field
              label="Children"
              value={children}
              onChangeText={setChildren}
              placeholder="0"
              keyboardType="phone-pad"
            />
            <Field
              label="Special request"
              value={special}
              onChangeText={setSpecial}
              placeholder="Optional request"
            />
            <Button
              title={busy ? "Submitting…" : "Submit reservation request"}
              onPress={createBooking}
              disabled={busy}
            />
          </ScrollView>
        </View>
      )}
      {payBooking && (
        <View style={s.modalShade}>
          <ScrollView style={s.modal} contentContainerStyle={{ padding: 20 }}>
            <Pressable onPress={() => setPayBooking(null)}>
              <Text style={s.close}>✕ Close</Text>
            </Pressable>
            <Text style={s.heading}>Submit payment</Text>
            <Text style={s.subheading}>
              {payBooking.reference} • Total {money(payBooking.total)}
            </Text>
            <Text style={s.label}>Payment method</Text>
            <View style={s.toggleRow}>
              {(["GCASH", "BANK_TRANSFER", "CASH_ON_ARRIVAL"] as const).map(
                (m) => (
                  <Pressable
                    key={m}
                    onPress={() => setPayMethod(m)}
                    style={[s.toggle, payMethod === m && s.toggleActive]}
                  >
                    <Text
                      style={[
                        s.toggleText,
                        payMethod === m && { color: C.white },
                      ]}
                    >
                      {m.replace("_", " ")}
                    </Text>
                  </Pressable>
                ),
              )}
            </View>
            <Field
              label="Amount (PHP)"
              value={payAmount}
              onChangeText={setPayAmount}
              placeholder="0.00"
              keyboardType="phone-pad"
            />
            <Field
              label="Reference number (optional)"
              value={payReference}
              onChangeText={setPayReference}
              placeholder="Transaction reference"
            />
            <Text style={s.meta}>
              Payment is reviewed manually by the resort. Do not submit
              sensitive bank credentials or PINs.
            </Text>
            <Button
              title={busy ? "Submitting…" : "Submit for verification"}
              onPress={submitPayment}
              disabled={busy}
            />
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}
function AccommodationList({
  items,
  onSelect,
}: {
  items: Accommodation[];
  onSelect: (item: Accommodation) => void;
}) {
  if (!items.length)
    return <Empty text="No accommodations are available right now." />;
  return (
    <View>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => onSelect(item)}
          style={s.listCard}
        >
          {!!item.image_url && (
            <Image source={{ uri: item.image_url }} style={s.cardImage} />
          )}
          <View style={{ padding: 14 }}>
            <Text style={s.category}>{item.category.toUpperCase()}</Text>
            <Text style={s.cardTitle}>{item.name}</Text>
            <Text style={s.meta}>{item.description}</Text>
            <View style={s.rowBetween}>
              <Text style={s.price}>
                {item.day_price
                  ? money(item.day_price)
                  : money(item.night_price)}{" "}
                <Text style={s.meta}>
                  {item.day_price ? "/ day-use" : "/ night"}
                </Text>
              </Text>
              <Text style={s.link}>View details →</Text>
            </View>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
function AdminBookings({
  bookings,
  onUpdate,
}: {
  bookings: Booking[];
  onUpdate: (id: string, status: "CONFIRMED" | "REJECTED") => void;
}) {
  if (!bookings.length) return <Empty text="No reservations to review." />;
  return (
    <View>
      {bookings.map((b) => (
        <View key={b.id} style={s.bookingCard}>
          <View style={s.rowBetween}>
            <Text style={s.cardTitle}>
              {b.accommodation_name ?? b.reference}
            </Text>
            <StatusPill status={b.status} />
          </View>
          <Text style={s.meta}>
            {b.reference} • {b.kind.replace("_", " ")}
          </Text>
          <Text style={s.meta}>{new Date(b.start_at).toLocaleString()}</Text>
          <Text style={s.price}>{money(b.total)}</Text>
          {b.status === "PENDING" && (
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Approve"
                  onPress={() => onUpdate(b.id, "CONFIRMED")}
                />
              </View>
              <View style={{ width: 10 }} />
              <View style={{ flex: 1 }}>
                <Button
                  title="Reject"
                  onPress={() => onUpdate(b.id, "REJECTED")}
                  secondary
                />
              </View>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}
function StatusPill({ status }: { status: string }) {
  const color =
    status === "CONFIRMED" || status === "COMPLETED"
      ? C.green
      : status === "REJECTED" || status === "CANCELLED"
        ? C.red
        : C.orange;
  return (
    <View style={[s.pill, { backgroundColor: `${color}18` }]}>
      <Text style={{ color, fontWeight: "800", fontSize: 10 }}>{status}</Text>
    </View>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <View style={s.empty}>
      <Text style={{ fontSize: 28 }}>🌊</Text>
      <Text style={s.meta}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.sand },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.sand,
    gap: 12,
  },
  authWrap: { flexGrow: 1, justifyContent: "center", padding: 24 },
  brandMark: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: "#D9F0EA",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 12,
  },
  brand: {
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: 3,
    color: C.navy,
    textAlign: "center",
  },
  brandSub: {
    color: C.muted,
    textAlign: "center",
    marginTop: 5,
    marginBottom: 24,
  },
  authCard: {
    backgroundColor: C.white,
    borderRadius: 26,
    padding: 22,
    elevation: 3,
  },
  heading: {
    fontSize: 24,
    fontWeight: "900",
    color: C.navy,
    letterSpacing: -0.5,
  },
  subheading: {
    fontSize: 13,
    color: C.muted,
    lineHeight: 20,
    marginTop: 5,
    marginBottom: 18,
  },
  label: { fontSize: 12, fontWeight: "800", color: C.navy, marginBottom: 7 },
  input: {
    backgroundColor: "#F7FAF8",
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: C.navy,
    fontSize: 14,
  },
  button: {
    backgroundColor: C.ocean,
    borderRadius: 14,
    padding: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonSecondary: {
    backgroundColor: "#E7F3F0",
    borderWidth: 1,
    borderColor: "#C8E2DC",
  },
  buttonText: { color: C.white, fontWeight: "900", fontSize: 14 },
  link: { color: C.ocean, fontWeight: "800", fontSize: 13 },
  footnote: {
    textAlign: "center",
    color: C.muted,
    fontSize: 11,
    marginTop: 22,
  },
  topbar: {
    height: 68,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.sand,
  },
  topBrand: { fontSize: 18, fontWeight: "900", color: C.navy },
  topCaption: { fontSize: 11, color: C.muted, marginTop: 2 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "#D9F0EA",
    alignItems: "center",
    justifyContent: "center",
  },
  content: { padding: 18, paddingBottom: 32 },
  hero: {
    backgroundColor: C.navy,
    borderRadius: 26,
    padding: 23,
    marginBottom: 26,
    overflow: "hidden",
  },
  heroEyebrow: {
    color: "#8ED8CB",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
  },
  heroTitle: {
    fontSize: 34,
    lineHeight: 39,
    fontWeight: "900",
    color: C.white,
    marginTop: 12,
  },
  heroText: {
    color: "#D2E6E1",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
    maxWidth: 260,
  },
  heroPill: {
    alignSelf: "flex-start",
    backgroundColor: C.orange,
    borderRadius: 30,
    paddingHorizontal: 16,
    paddingVertical: 11,
    marginTop: 18,
  },
  heroPillText: { color: C.navy, fontWeight: "900", fontSize: 12 },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 26,
  },
  quick: {
    width: "48%",
    backgroundColor: C.white,
    borderRadius: 18,
    padding: 15,
    minHeight: 90,
    justifyContent: "space-between",
  },
  quickText: { fontSize: 12, color: C.navy, fontWeight: "800", marginTop: 12 },
  listCard: {
    backgroundColor: C.white,
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 14,
  },
  cardImage: { height: 150, width: "100%", backgroundColor: "#DDEAE6" },
  category: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
    color: C.teal,
  },
  cardTitle: { fontSize: 16, fontWeight: "900", color: C.navy, marginTop: 5 },
  meta: { fontSize: 11, color: C.muted, lineHeight: 17, marginTop: 5 },
  price: { fontSize: 17, fontWeight: "900", color: C.ocean, marginTop: 10 },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  row: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  bookingCard: {
    backgroundColor: C.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  pill: { borderRadius: 30, paddingHorizontal: 10, paddingVertical: 6 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 },
  stat: {
    width: "48%",
    backgroundColor: C.white,
    borderRadius: 18,
    padding: 15,
  },
  statValue: { fontSize: 23, fontWeight: "900", color: C.ocean },
  statLabel: { fontSize: 11, color: C.muted, marginTop: 4 },
  nav: {
    height: 66,
    backgroundColor: C.white,
    borderTopWidth: 1,
    borderTopColor: C.line,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  navItem: { alignItems: "center", justifyContent: "center", flex: 1 },
  navIcon: { fontSize: 19, color: "#8DA3A0" },
  navText: { fontSize: 9, color: C.muted, marginTop: 3 },
  empty: {
    backgroundColor: C.white,
    borderRadius: 18,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  modalShade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(9,31,34,.55)",
    justifyContent: "flex-end",
  },
  modal: {
    maxHeight: "92%",
    backgroundColor: C.sand,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  close: { color: C.ocean, fontWeight: "900", marginBottom: 15 },
  toggleRow: {
    flexDirection: "row",
    backgroundColor: "#E5EEEA",
    padding: 4,
    borderRadius: 14,
    marginTop: 14,
  },
  toggle: { flex: 1, padding: 12, alignItems: "center", borderRadius: 11 },
  toggleActive: { backgroundColor: C.ocean },
  toggleText: { fontWeight: "800", fontSize: 12, color: C.navy },
});
