import React, { useEffect, useMemo, useState } from "react";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { api, clearToken, saveToken } from "./src/services/api";
import { uiEvents } from "./src/events/event-bus";

type Role = "ADMIN" | "CUSTOMER";

type User = {
  id: string;
  email: string;
  role: Role;
  fullName: string;
};

type InventoryKind =
  | "FUNCTION_HALL"
  | "COTTAGE"
  | "ROOM"
  | "DAY_USE_PACKAGE"
  | "OVERNIGHT_PACKAGE";

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

type FunctionHall = {
  id: string;
  name: string;
  description: string;
  capacity: number;
  hourly_rate: number;
  whole_day_rate: number;
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

type AnalyticsData = {
  period: {
    from: string;
    to: string;
  };
  summary: {
    totalBookings: number;
    pendingBookings: number;
    confirmedBookings: number;
    checkedInBookings: number;
    completedBookings: number;
    cancelledBookings: number;
    totalFunctionHallBookings: number;
    combinedTotalBookings: number;
    totalRevenue: number;
    verifiedPayments: number;
    newCustomers: number;
  };
  functionHall: {
    totalBookings: number;
    pendingBookings: number;
    confirmedBookings: number;
    completedBookings: number;
    rejectedBookings: number;
    cancelledBookings: number;
    totalRevenue: number;
    verifiedPayments: number;
    bookingsByStatus: {
      status: string;
      count: number;
    }[];
  };
  bookingsByKind: {
    kind: string;
    count: number;
  }[];
  bookingsByStatus: {
    status: string;
    count: number;
  }[];
  paymentsByMethod: {
    method: string;
    count: number;
    total: number;
  }[];
  revenueTrend: {
    date: string;
    revenue: number;
  }[];
  topAccommodations: {
    id: string;
    name: string;
    category: string;
    bookingCount: number;
  }[];
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
  `₱${Number(v || 0).toLocaleString("en-PH", {
    maximumFractionDigits: 2,
  })}`;

const formatDate = (date: Date) =>
  date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

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
  const [visible, setVisible] = useState(false);
  const isPassword = !!secureTextEntry;

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: C.line,
          borderRadius: 12,
          backgroundColor: C.white,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9AAEAC"
          secureTextEntry={isPassword && !visible}
          keyboardType={keyboardType}
          autoCapitalize={
            keyboardType === "email-address" ? "none" : "sentences"
          }
          style={[s.input, { flex: 1, borderWidth: 0 }]}
        />

        {isPassword && (
          <Pressable
            onPress={() => setVisible(!visible)}
            style={{ paddingHorizontal: 14, paddingVertical: 10 }}
          >
            <Text style={{ color: C.ocean, fontWeight: "700" }}>
              {visible ? "HIDE" : "SHOW"}
            </Text>
          </Pressable>
        )}
      </View>
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
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("Home");

  const [items, setItems] = useState<Accommodation[]>([]);
  const [functionHalls, setFunctionHalls] = useState<FunctionHall[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("All");

  // Admin inventory editor states
  const [showInventoryForm, setShowInventoryForm] = useState(false);
  const [editingInventoryId, setEditingInventoryId] = useState<string | null>(
    null,
  );

  const [inventoryKind, setInventoryKind] = useState<InventoryKind>("COTTAGE");

  const [inventoryName, setInventoryName] = useState("");
  const [inventoryDescription, setInventoryDescription] = useState("");
  const [inventoryImageUrl, setInventoryImageUrl] = useState("");

  const [inventoryCapacity, setInventoryCapacity] = useState("50");
  const [inventoryAdults, setInventoryAdults] = useState("2");
  const [inventoryChildren, setInventoryChildren] = useState("0");

  const [inventoryDayPrice, setInventoryDayPrice] = useState("0");
  const [inventoryNightPrice, setInventoryNightPrice] = useState("0");
  const [inventoryExtraAdultFee, setInventoryExtraAdultFee] = useState("0");
  const [inventoryExtraChildFee, setInventoryExtraChildFee] = useState("0");

  const [inventoryHourlyRate, setInventoryHourlyRate] = useState("0");
  const [inventoryWholeDayRate, setInventoryWholeDayRate] = useState("0");

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
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<
    "today" | "week" | "month" | "year"
  >("month");
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [payBooking, setPayBooking] = useState<Booking | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payReference, setPayReference] = useState("");

  // Customer payment submissions currently use GCash only.
  const payMethod = "GCASH" as const;

  const [refreshing, setRefreshing] = useState(false);

  const [selected, setSelected] = useState<Accommodation | null>(null);
  const [kind, setKind] = useState<"DAY_USE" | "OVERNIGHT">("DAY_USE");

  // Reservation calendar states
  const [arrivalDate, setArrivalDate] = useState(new Date());

  const [departureDate, setDepartureDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  });

  const [showArrivalPicker, setShowArrivalPicker] = useState(false);
  const [showDeparturePicker, setShowDeparturePicker] = useState(false);

  const [adults, setAdults] = useState("2");
  const [children, setChildren] = useState("0");
  const [special, setSpecial] = useState("");

  // Restore logged-in user
  useEffect(() => {
    (async () => {
      try {
        const { user } = await api<{ user: User }>("/auth/me");
        setUser(user);
      } catch {
        // No active session.
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // Event listener
  useEffect(() => {
    const off = uiEvents.on("loginSucceeded", () => {
      setTab("Home");
    });

    return off;
  }, []);

  // Load dashboard and application data
  const load = async () => {
    if (!user) return;

    setRefreshing(true);

    try {
      if (user.role === "CUSTOMER") {
        const [a, b, p, h] = await Promise.all([
          api<{ data: Accommodation[] }>("/accommodations"),
          api<{ data: Booking[] }>("/bookings/mine"),
          api<{ data: Payment[] }>("/payments/mine"),
          api<{ data: FunctionHall[] }>("/function-halls"),
        ]);

        setItems(a.data);
        setBookings(b.data);
        setPayments(p.data);
        setFunctionHalls(h.data);

        uiEvents.emit("catalogLoaded", {
          count: a.data.length,
        });
      } else {
        const [d, b, p, a, h] = await Promise.all([
          api<{ data: Record<string, number> }>("/admin/dashboard"),
          api<{ data: Booking[] }>("/admin/bookings"),
          api<{ data: Payment[] }>("/admin/payments"),
          api<{ data: Accommodation[] }>("/admin/accommodations"),
          api<{ data: FunctionHall[] }>("/admin/function-halls"),
        ]);

        setDashboard(d.data);
        setBookings(b.data);
        setPayments(p.data);
        setItems(a.data);
        setFunctionHalls(h.data);
      }
    } catch (e) {
      Alert.alert("Unable to refresh", (e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const loadAnalytics = async (
    period: "today" | "week" | "month" | "year" = analyticsPeriod,
  ) => {
    setAnalyticsLoading(true);

    try {
      const now = new Date();
      const from = new Date(now);

      if (period === "today") {
        // Current day
      } else if (period === "week") {
        from.setDate(now.getDate() - 6);
      } else if (period === "month") {
        from.setDate(now.getDate() - 29);
      } else {
        from.setMonth(0, 1);
      }

      const formatISODate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      };

      const result = await api<{ data: AnalyticsData }>(
        `/admin/analytics?from=${formatISODate(from)}&to=${formatISODate(now)}`,
      );

      setAnalytics(result.data);
    } catch (error) {
      Alert.alert("Analytics Error", (error as Error).message);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user]);

  useEffect(() => {
    if (user?.role === "ADMIN" && tab === "Analytics") {
      loadAnalytics();
    }
  }, [user, tab, analyticsPeriod]);

  // Login and registration
  const auth = async () => {
    setBusy(true);

    try {
      if (mode === "register") {
        await api("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            fullName,
            phone,
          }),
        });

        Alert.alert("Account created", "You can now sign in.");
        setMode("login");
      } else {
        const result = await api<{
          token: string;
          user: User;
        }>("/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
          }),
        });

        await saveToken(result.token);
        setUser(result.user);

        uiEvents.emit("loginSucceeded", {
          userId: result.user.id,
        });
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

  // Logout
  const logout = async () => {
    try {
      await api("/auth/logout", {
        method: "POST",
      });
    } catch {
      // Continue local logout even if the server request fails.
    }

    await clearToken();

    setUser(null);
    setItems([]);
    setBookings([]);
    setSelected(null);
    setMode("login");
  };

  // Create reservation using calendar-selected dates
  const createBooking = async () => {
    if (!selected) return;

    const start = new Date(arrivalDate);
    const end = new Date(departureDate);

    if (kind === "DAY_USE") {
      start.setHours(9, 0, 0, 0);
      end.setHours(17, 0, 0, 0);
    } else {
      start.setHours(14, 0, 0, 0);
      end.setHours(11, 0, 0, 0);
    }

    if (end <= start) {
      Alert.alert(
        "Invalid reservation dates",
        "Departure or check-out must be after arrival or check-in.",
      );
      return;
    }

    const adultCount = Number(adults);
    const childCount = Number(children);

    if (!Number.isInteger(adultCount) || adultCount < 1) {
      Alert.alert("Invalid guest count", "At least one adult is required.");
      return;
    }

    if (!Number.isInteger(childCount) || childCount < 0) {
      Alert.alert("Invalid guest count", "Enter a valid number of children.");
      return;
    }

    if (adultCount > selected.capacity_adults) {
      Alert.alert(
        "Adult capacity exceeded",
        `This accommodation allows up to ${selected.capacity_adults} adults.`,
      );
      return;
    }

    if (childCount > selected.capacity_children) {
      Alert.alert(
        "Children capacity exceeded",
        `This accommodation allows up to ${selected.capacity_children} children.`,
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
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          adults: adultCount,
          children: childCount,
          specialRequest: special,
        }),
      });

      uiEvents.emit("bookingSubmitted", {
        bookingId: result.data.id,
      });

      Alert.alert(
        "Reservation submitted",
        `Reference: ${result.data.reference}\nStatus: Pending admin approval.`,
      );

      setSelected(null);
      setShowArrivalPicker(false);
      setShowDeparturePicker(false);
      setTab("My Bookings");

      await load();
    } catch (e) {
      Alert.alert("Could not submit booking", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Admin booking approval/rejection
  const updateBooking = async (
    id: string,
    status: "CONFIRMED" | "REJECTED",
  ) => {
    try {
      await api(`/admin/bookings/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
        }),
      });

      await load();
    } catch (e) {
      Alert.alert("Update failed", (e as Error).message);
    }
  };
  const checkOutBooking = (id: string) => {
    Alert.alert(
      "Confirm Check Out",
      "Are you sure you want to check out this customer? The accommodation will become available again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Check Out",
          onPress: async () => {
            setBusy(true);

            try {
              await api(`/admin/bookings/${id}/check-out`, {
                method: "POST",
                body: JSON.stringify({ extraCharge: 0 }),
              });

              Alert.alert(
                "Checkout Successful",
                "The customer has been checked out. The accommodation is now available again.",
              );

              await load();
            } catch (error) {
              Alert.alert("Checkout Failed", (error as Error).message);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };
  // Admin check-in customer
  const checkInBooking = async (id: string) => {
    Alert.alert(
      "Confirm Check In",
      "Are you sure you want to check in this customer?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Check In",
          onPress: async () => {
            setBusy(true);

            try {
              await api(`/admin/bookings/${id}/check-in`, {
                method: "POST",
              });

              Alert.alert(
                "Check In Successful",
                "Customer has been checked in successfully.",
              );

              await load();
            } catch (error) {
              Alert.alert("Check In Failed", (error as Error).message);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };
  // Customer payment submission
  const submitPayment = async () => {
    if (!payBooking || !Number(payAmount) || Number(payAmount) <= 0) {
      Alert.alert(
        "Enter payment amount",
        "Please enter a valid payment amount greater than zero.",
      );
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
        "Your GCash payment is pending manual verification by the resort.",
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

  // Admin payment verification
  const updatePayment = async (id: string, status: "VERIFIED" | "REJECTED") => {
    try {
      await api(`/admin/payments/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
        }),
      });

      await load();
    } catch (e) {
      Alert.alert("Payment update failed", (e as Error).message);
    }
  };

  // Save new inventory to the database
  const saveInventory = async () => {
    if (!inventoryName.trim() || !inventoryDescription.trim()) {
      Alert.alert(
        "Required fields",
        "Please enter the inventory name and description.",
      );
      return;
    }

    if (inventoryKind === "FUNCTION_HALL") {
      const capacity = Number(inventoryCapacity);
      const hourlyRate = Number(inventoryHourlyRate);
      const wholeDayRate = Number(inventoryWholeDayRate);

      if (
        !Number.isInteger(capacity) ||
        capacity < 1 ||
        !Number.isFinite(hourlyRate) ||
        hourlyRate < 0 ||
        !Number.isFinite(wholeDayRate) ||
        wholeDayRate < 0
      ) {
        Alert.alert(
          "Invalid details",
          "Please enter a valid capacity and rates.",
        );
        return;
      }

      try {
        setBusy(true);

        await api("/admin/function-halls", {
          method: "POST",
          body: JSON.stringify({
            name: inventoryName.trim(),
            description: inventoryDescription.trim(),
            capacity,
            hourlyRate,
            wholeDayRate,
            imageUrl: inventoryImageUrl.trim() || undefined,
          }),
        });

        Alert.alert(
          "Success",
          "Function Hall has been added and is now active.",
        );
        setShowInventoryForm(false);
        await load();
      } catch (error) {
        Alert.alert("Save failed", (error as Error).message);
      } finally {
        setBusy(false);
      }

      return;
    }

    const capacityAdults = Number(inventoryAdults);
    const capacityChildren = Number(inventoryChildren);
    const dayPrice = Number(inventoryDayPrice);
    const nightPrice = Number(inventoryNightPrice);
    const extraAdultFee = Number(inventoryExtraAdultFee);
    const extraChildFee = Number(inventoryExtraChildFee);

    if (
      !Number.isInteger(capacityAdults) ||
      capacityAdults < 1 ||
      !Number.isInteger(capacityChildren) ||
      capacityChildren < 0 ||
      ![dayPrice, nightPrice, extraAdultFee, extraChildFee].every(
        (value) => Number.isFinite(value) && value >= 0,
      )
    ) {
      Alert.alert("Invalid details", "Please check the capacities and prices.");
      return;
    }

    const categoryMap: Record<
      Exclude<InventoryKind, "FUNCTION_HALL">,
      string
    > = {
      COTTAGE: "Cottages",
      ROOM: "Rooms",
      DAY_USE_PACKAGE: "Day-use Packages",
      OVERNIGHT_PACKAGE: "Overnight Packages",
    };

    try {
      setBusy(true);

      await api("/admin/accommodations", {
        method: "POST",
        body: JSON.stringify({
          name: inventoryName.trim(),
          category:
            categoryMap[
              inventoryKind as Exclude<InventoryKind, "FUNCTION_HALL">
            ],
          description: inventoryDescription.trim(),
          capacityAdults,
          capacityChildren,
          dayPrice,
          nightPrice,
          extraAdultFee,
          extraChildFee,
          imageUrl: inventoryImageUrl.trim() || undefined,
        }),
      });

      Alert.alert("Success", "Inventory has been added and is now active.");
      setShowInventoryForm(false);
      await load();
    } catch (error) {
      Alert.alert("Save failed", (error as Error).message);
    } finally {
      setBusy(false);
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

  // Loading screen
  if (booting) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator size="large" color={C.ocean} />
        <Text style={s.subheading}>Preparing your resort experience…</Text>
      </SafeAreaView>
    );
  }

  // Authentication screen
  if (!user) {
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
  }

  // Main application
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
        {/* CUSTOMER HOME */}
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
            <Header
              title="Function Hall"
              subtitle="Celebrate your special occasions with us."
            />

            <View style={s.bookingCard}>
              <View style={s.rowBetween}>
                <Text style={s.cardTitle}>Function Halls</Text>
                <Text style={[s.link, { fontSize: 13 }]}>
                  {functionHalls.length} available
                </Text>
              </View>

              <Text style={s.meta}>
                Active Function Hall listings available for reservation. Select
                your preferred schedule to check actual availability.
              </Text>
            </View>

            {functionHalls.length === 0 ? (
              <Empty text="No Function Hall is currently listed." />
            ) : (
              functionHalls.map((hall) => (
                <Pressable
                  key={hall.id}
                  style={s.listCard}
                  onPress={() =>
                    Alert.alert(
                      hall.name,
                      `${hall.description}\n\nCapacity: ${hall.capacity} guests\nHourly rate: ${money(hall.hourly_rate)}\nWhole-day rate (8 hours): ${money(hall.whole_day_rate)}`,
                    )
                  }
                >
                  {!!hall.image_url && (
                    <Image
                      source={{ uri: hall.image_url }}
                      style={s.cardImage}
                    />
                  )}

                  <View style={{ padding: 14 }}>
                    <Text style={s.category}>EVENT VENUE</Text>

                    <Text style={s.cardTitle}>{hall.name}</Text>

                    <Text style={s.meta}>{hall.description}</Text>

                    <Text style={s.meta}>Capacity: {hall.capacity} guests</Text>

                    <Text style={s.price}>
                      {money(hall.hourly_rate)} / hour
                    </Text>

                    <Text style={s.meta}>
                      Whole day (8 hours): {money(hall.whole_day_rate)}
                    </Text>

                    <Text style={[s.link, { marginTop: 12 }]}>
                      View Function Hall details →
                    </Text>
                  </View>
                </Pressable>
              ))
            )}

            <Header title="Guest favorites" />

            <AccommodationList
              items={items.slice(0, 3)}
              onSelect={setSelected}
            />

            <Header title="Guest favorites" />

            <AccommodationList
              items={items.slice(0, 3)}
              onSelect={setSelected}
            />
          </>
        )}

        {/* CUSTOMER EXPLORE */}
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

        {/* CUSTOMER BOOKINGS */}
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

        {/* CUSTOMER PAYMENTS */}
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
                    {b.reference} • Total {money(b.total)}
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

        {/* CUSTOMER PROFILE */}
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

        {/* ADMIN HOME */}
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
              onCheckIn={checkInBooking}
              onCheckOut={checkOutBooking}
            />
          </>
        )}
        {/* ADMIN ANALYTICS */}
        {user.role === "ADMIN" && tab === "Analytics" && (
          <>
            <Header
              title="Resort Analytics"
              subtitle="Real-time business performance based on your resort records."
            />

            <View style={s.toggleRow}>
              {(["today", "week", "month", "year"] as const).map((period) => (
                <Pressable
                  key={period}
                  onPress={() => setAnalyticsPeriod(period)}
                  style={[
                    s.toggle,
                    analyticsPeriod === period && s.toggleActive,
                  ]}
                >
                  <Text
                    style={[
                      s.toggleText,
                      analyticsPeriod === period && { color: C.white },
                    ]}
                  >
                    {period === "today"
                      ? "Today"
                      : period === "week"
                        ? "Week"
                        : period === "month"
                          ? "Month"
                          : "Year"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {analyticsLoading && !analytics ? (
              <View style={s.empty}>
                <ActivityIndicator size="large" color={C.ocean} />
                <Text style={s.meta}>Loading analytics...</Text>
              </View>
            ) : analytics ? (
              <>
                <Text style={s.meta}>
                  Period: {analytics.period.from} to {analytics.period.to}
                </Text>

                <View style={s.stats}>
                  {[
                    ["Revenue", money(analytics.summary.totalRevenue)],
                    [
                      "Combined bookings",
                      analytics.summary.combinedTotalBookings,
                    ],
                    ["New customers", analytics.summary.newCustomers],
                    ["Verified payments", analytics.summary.verifiedPayments],
                  ].map(([label, value]) => (
                    <View key={String(label)} style={s.stat}>
                      <Text style={s.statValue}>{value}</Text>
                      <Text style={s.statLabel}>{label}</Text>
                    </View>
                  ))}
                </View>

                <Header title="Booking status" />

                <Header
                  title="Function Hall Performance"
                  subtitle="Reservation and verified payment summary."
                />

                <View style={s.stats}>
                  {[
                    [
                      "Total reservations",
                      analytics.functionHall.totalBookings,
                    ],
                    ["Pending", analytics.functionHall.pendingBookings],
                    ["Confirmed", analytics.functionHall.confirmedBookings],
                    ["Completed", analytics.functionHall.completedBookings],
                    ["Rejected", analytics.functionHall.rejectedBookings],
                    ["Cancelled", analytics.functionHall.cancelledBookings],
                    [
                      "Verified revenue",
                      money(analytics.functionHall.totalRevenue),
                    ],
                    [
                      "Verified payments",
                      analytics.functionHall.verifiedPayments,
                    ],
                  ].map(([label, value]) => (
                    <View key={String(label)} style={s.stat}>
                      <Text style={s.statValue}>{value}</Text>
                      <Text style={s.statLabel}>{label}</Text>
                    </View>
                  ))}
                </View>

                <Header title="Function Hall Reservation Status" />

                <View style={s.bookingCard}>
                  {analytics.functionHall.bookingsByStatus.length === 0 ? (
                    <Empty text="No Function Hall reservations for this period." />
                  ) : (
                    analytics.functionHall.bookingsByStatus.map((item) => (
                      <View key={item.status} style={{ marginBottom: 14 }}>
                        <View style={s.rowBetween}>
                          <Text style={s.meta}>
                            {item.status.replace("_", " ")}
                          </Text>
                          <Text style={[s.meta, { fontWeight: "900" }]}>
                            {item.count}
                          </Text>
                        </View>

                        <View style={analyticsStyles.track}>
                          <View
                            style={[
                              analyticsStyles.bar,
                              {
                                width: `${
                                  analytics.functionHall.totalBookings > 0
                                    ? (item.count /
                                        analytics.functionHall.totalBookings) *
                                      100
                                    : 0
                                }%`,
                              },
                            ]}
                          />
                        </View>
                      </View>
                    ))
                  )}
                </View>

                <View style={s.bookingCard}>
                  {analytics.bookingsByStatus.length === 0 ? (
                    <Empty text="No bookings recorded for this period." />
                  ) : (
                    analytics.bookingsByStatus.map((item) => (
                      <View key={item.status} style={{ marginBottom: 14 }}>
                        <View style={s.rowBetween}>
                          <Text style={s.meta}>
                            {item.status.replace("_", " ")}
                          </Text>
                          <Text style={[s.meta, { fontWeight: "900" }]}>
                            {item.count}
                          </Text>
                        </View>
                        <View style={analyticsStyles.track}>
                          <View
                            style={[
                              analyticsStyles.bar,
                              {
                                width: `${
                                  analytics.summary.totalBookings > 0
                                    ? (item.count /
                                        analytics.summary.totalBookings) *
                                      100
                                    : 0
                                }%`,
                              },
                            ]}
                          />
                        </View>
                      </View>
                    ))
                  )}
                </View>

                <Header title="Reservation types" />

                <View style={s.stats}>
                  {analytics.bookingsByKind.map((item) => (
                    <View key={item.kind} style={s.stat}>
                      <Text style={s.statValue}>{item.count}</Text>
                      <Text style={s.statLabel}>
                        {item.kind.replace("_", " ")}
                      </Text>
                    </View>
                  ))}
                </View>

                <Header title="Revenue trend" />

                <View style={s.bookingCard}>
                  {analytics.revenueTrend.length === 0 ? (
                    <Empty text="No verified revenue for this period." />
                  ) : (
                    analytics.revenueTrend.map((item) => {
                      const maxRevenue = Math.max(
                        ...analytics.revenueTrend.map((x) => x.revenue),
                        1,
                      );

                      return (
                        <View key={item.date} style={{ marginBottom: 14 }}>
                          <View style={s.rowBetween}>
                            <Text style={s.meta}>{item.date}</Text>
                            <Text style={[s.meta, { fontWeight: "900" }]}>
                              {money(item.revenue)}
                            </Text>
                          </View>
                          <View style={analyticsStyles.track}>
                            <View
                              style={[
                                analyticsStyles.bar,
                                {
                                  width: `${(item.revenue / maxRevenue) * 100}%`,
                                },
                              ]}
                            />
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>

                <Header title="Payment methods" />

                <View style={s.bookingCard}>
                  {analytics.paymentsByMethod.length === 0 ? (
                    <Empty text="No verified payments for this period." />
                  ) : (
                    analytics.paymentsByMethod.map((item) => (
                      <View key={item.method} style={s.rowBetween}>
                        <View>
                          <Text style={s.cardTitle}>
                            {item.method.replaceAll("_", " ")}
                          </Text>
                          <Text style={s.meta}>
                            {item.count} verified payment(s)
                          </Text>
                        </View>
                        <Text style={s.price}>{money(item.total)}</Text>
                      </View>
                    ))
                  )}
                </View>

                <Header title="Top accommodations" />

                {analytics.topAccommodations.length === 0 ? (
                  <Empty text="No accommodation bookings for this period." />
                ) : (
                  analytics.topAccommodations.map((item, index) => (
                    <View key={item.id} style={s.bookingCard}>
                      <View style={s.rowBetween}>
                        <Text style={s.cardTitle}>
                          {index + 1}. {item.name}
                        </Text>
                        <Text style={s.price}>
                          {item.bookingCount} bookings
                        </Text>
                      </View>
                      <Text style={s.meta}>{item.category}</Text>
                    </View>
                  ))
                )}

                <Button
                  title={
                    analyticsLoading ? "Refreshing..." : "Refresh analytics"
                  }
                  onPress={() => loadAnalytics()}
                  disabled={analyticsLoading}
                  secondary
                />
              </>
            ) : (
              <Empty text="Analytics data is not available." />
            )}
          </>
        )}

        {/* ADMIN PAYMENTS */}
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

        {/* ADMIN RESERVATIONS */}
        {user.role === "ADMIN" && tab === "Reservations" && (
          <>
            <Header
              title="Reservation management"
              subtitle="Review requests and update their status."
            />
            <AdminBookings
              bookings={bookings}
              onUpdate={updateBooking}
              onCheckIn={checkInBooking}
              onCheckOut={checkOutBooking}
            />
          </>
        )}

        {/* ADMIN INVENTORY */}
        {user.role === "ADMIN" && tab === "Inventory" && (
          <>
            <Header
              title="Resort Inventory"
              subtitle="Manage Function Halls, Cottages, Rooms, and Packages."
            />

            {!showInventoryForm ? (
              <Button
                title="+ Add New Inventory"
                onPress={() => {
                  setEditingInventoryId(null);
                  setInventoryKind("COTTAGE");
                  setInventoryName("");
                  setInventoryDescription("");
                  setInventoryImageUrl("");
                  setInventoryCapacity("50");
                  setInventoryAdults("2");
                  setInventoryChildren("0");
                  setInventoryDayPrice("0");
                  setInventoryNightPrice("0");
                  setInventoryExtraAdultFee("0");
                  setInventoryExtraChildFee("0");
                  setInventoryHourlyRate("0");
                  setInventoryWholeDayRate("0");
                  setShowInventoryForm(true);
                }}
              />
            ) : (
              <View style={s.bookingCard}>
                <View style={s.rowBetween}>
                  <Text style={s.cardTitle}>
                    {editingInventoryId ? "Edit Inventory" : "Add Inventory"}
                  </Text>

                  <Pressable onPress={() => setShowInventoryForm(false)}>
                    <Text style={s.link}>Cancel</Text>
                  </Pressable>
                </View>

                <Text style={[s.label, { marginTop: 16 }]}>
                  Select inventory type
                </Text>

                {(
                  [
                    ["FUNCTION_HALL", "Function Hall"],
                    ["COTTAGE", "Cottage"],
                    ["ROOM", "Room"],
                    ["DAY_USE_PACKAGE", "Day-use Package"],
                    ["OVERNIGHT_PACKAGE", "Overnight Package"],
                  ] as [InventoryKind, string][]
                ).map(([value, label]) => (
                  <Pressable
                    key={value}
                    onPress={() => setInventoryKind(value)}
                    style={[
                      s.toggle,
                      {
                        backgroundColor:
                          inventoryKind === value ? C.ocean : "#E5EEEA",
                        marginBottom: 7,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        s.toggleText,
                        {
                          color: inventoryKind === value ? C.white : C.navy,
                        },
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}

                <Field
                  label="Name"
                  value={inventoryName}
                  onChangeText={setInventoryName}
                  placeholder="Enter inventory name"
                />

                <Field
                  label="Description"
                  value={inventoryDescription}
                  onChangeText={setInventoryDescription}
                  placeholder="Describe this facility or package"
                />

                <Field
                  label="Image URL (optional)"
                  value={inventoryImageUrl}
                  onChangeText={setInventoryImageUrl}
                  placeholder="https://example.com/image.jpg"
                />

                {inventoryKind === "FUNCTION_HALL" ? (
                  <>
                    <Field
                      label="Maximum guest capacity"
                      value={inventoryCapacity}
                      onChangeText={setInventoryCapacity}
                      placeholder="50"
                      keyboardType="phone-pad"
                    />

                    <Field
                      label="Hourly rate (PHP)"
                      value={inventoryHourlyRate}
                      onChangeText={setInventoryHourlyRate}
                      placeholder="0"
                      keyboardType="phone-pad"
                    />

                    <Field
                      label="Whole-day rate (8 hours, PHP)"
                      value={inventoryWholeDayRate}
                      onChangeText={setInventoryWholeDayRate}
                      placeholder="0"
                      keyboardType="phone-pad"
                    />
                  </>
                ) : (
                  <>
                    <Field
                      label="Adult capacity"
                      value={inventoryAdults}
                      onChangeText={setInventoryAdults}
                      placeholder="2"
                      keyboardType="phone-pad"
                    />

                    <Field
                      label="Children capacity"
                      value={inventoryChildren}
                      onChangeText={setInventoryChildren}
                      placeholder="0"
                      keyboardType="phone-pad"
                    />

                    <Field
                      label="Day-use price (PHP)"
                      value={inventoryDayPrice}
                      onChangeText={setInventoryDayPrice}
                      placeholder="0"
                      keyboardType="phone-pad"
                    />

                    <Field
                      label="Overnight price (PHP)"
                      value={inventoryNightPrice}
                      onChangeText={setInventoryNightPrice}
                      placeholder="0"
                      keyboardType="phone-pad"
                    />

                    <Field
                      label="Extra adult fee (PHP)"
                      value={inventoryExtraAdultFee}
                      onChangeText={setInventoryExtraAdultFee}
                      placeholder="0"
                      keyboardType="phone-pad"
                    />

                    <Field
                      label="Extra child fee (PHP)"
                      value={inventoryExtraChildFee}
                      onChangeText={setInventoryExtraChildFee}
                      placeholder="0"
                      keyboardType="phone-pad"
                    />
                  </>
                )}

                <Text style={s.meta}>
                  {inventoryKind === "FUNCTION_HALL"
                    ? "Function Hall reservations use hourly or 8-hour whole-day pricing."
                    : "Enter the applicable day-use and overnight prices for this listing."}
                </Text>

                <Button
                  title={busy ? "Saving..." : "Save Inventory"}
                  onPress={saveInventory}
                  disabled={busy}
                />
              </View>
            )}

            <Header title="Existing Inventory" />

            <AccommodationList
              items={items}
              onSelect={(item) =>
                Alert.alert("Inventory", `Selected: ${item.name}`)
              }
            />

            <Header title="Function Halls" />

            {functionHalls.length === 0 ? (
              <Empty text="No Function Hall listings yet." />
            ) : (
              functionHalls.map((hall) => (
                <View key={hall.id} style={s.bookingCard}>
                  <Text style={s.cardTitle}>{hall.name}</Text>
                  <Text style={s.meta}>{hall.description}</Text>
                  <Text style={s.meta}>Capacity: {hall.capacity} guests</Text>
                  <Text style={s.price}>{money(hall.hourly_rate)} / hour</Text>
                  <Text style={s.meta}>
                    Whole day: {money(hall.whole_day_rate)}
                  </Text>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* BOTTOM NAVIGATION */}
      <View style={s.nav}>
        {(user.role === "ADMIN"
          ? ["Home", "Analytics", "Reservations", "Payments", "Inventory"]
          : ["Home", "Explore", "My Bookings", "Payments", "Profile"]
        ).map((x, i) => (
          <Pressable
            key={x}
            onPress={() => {
              setTab(x);
              uiEvents.emit("screenChanged", {
                screen: x,
              });
            }}
            style={s.navItem}
          >
            <Text style={[s.navIcon, tab === x && { color: C.ocean }]}>
              {
                (user.role === "ADMIN"
                  ? ["▦", "▥", "▤", "₱", "⌂"]
                  : ["⌂", "◈", "▣", "₱", "○"])[i]
              }
            </Text>

            <Text
              style={[
                s.navText,
                tab === x && {
                  color: C.ocean,
                  fontWeight: "800",
                },
              ]}
            >
              {x}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* RESERVATION MODAL */}
      {selected && (
        <View style={s.modalShade}>
          <ScrollView
            style={s.modal}
            contentContainerStyle={{ padding: 20 }}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable
              onPress={() => {
                setSelected(null);
                setShowArrivalPicker(false);
                setShowDeparturePicker(false);
              }}
            >
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

            {/* ARRIVAL / CHECK-IN DATE */}
            <Text style={s.label}>
              {kind === "DAY_USE" ? "Arrival date" : "Check-in date"}
            </Text>

            <Pressable
              style={s.input}
              onPress={() => {
                setShowDeparturePicker(false);
                setShowArrivalPicker(true);
              }}
            >
              <Text style={{ color: C.navy }}>
                📅 {formatDate(arrivalDate)}
              </Text>
            </Pressable>

            {showArrivalPicker && (
              <DateTimePicker
                value={arrivalDate}
                mode="date"
                display="calendar"
                minimumDate={new Date()}
                onChange={(event, date) => {
                  setShowArrivalPicker(false);

                  if (event.type === "set" && date) {
                    setArrivalDate(date);

                    if (date > departureDate) {
                      setDepartureDate(date);
                    }
                  }
                }}
              />
            )}

            {/* DEPARTURE / CHECK-OUT DATE */}
            <Text style={[s.label, { marginTop: 12 }]}>
              {kind === "DAY_USE" ? "Departure date" : "Check-out date"}
            </Text>

            <Pressable
              style={s.input}
              onPress={() => {
                setShowArrivalPicker(false);
                setShowDeparturePicker(true);
              }}
            >
              <Text style={{ color: C.navy }}>
                📅 {formatDate(departureDate)}
              </Text>
            </Pressable>

            {showDeparturePicker && (
              <DateTimePicker
                value={departureDate}
                mode="date"
                display="calendar"
                minimumDate={arrivalDate}
                onChange={(event, date) => {
                  setShowDeparturePicker(false);

                  if (event.type === "set" && date) {
                    setDepartureDate(date);
                  }
                }}
              />
            )}

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

      {/* PAYMENT MODAL */}
      {payBooking && (
        <View style={s.modalShade}>
          <ScrollView
            style={s.modal}
            contentContainerStyle={{ padding: 20 }}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable onPress={() => setPayBooking(null)}>
              <Text style={s.close}>✕ Close</Text>
            </Pressable>

            <Text style={s.heading}>Submit payment</Text>

            <Text style={s.subheading}>
              {payBooking.reference} • Total {money(payBooking.total)}
            </Text>

            <Text style={s.label}>Payment method</Text>

            <View style={[s.toggle, s.toggleActive, { marginBottom: 14 }]}>
              <Text style={[s.toggleText, { color: C.white }]}>GCASH</Text>
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

// ACCOMMODATION LIST
function AccommodationList({
  items,
  onSelect,
}: {
  items: Accommodation[];
  onSelect: (item: Accommodation) => void;
}) {
  if (!items.length) {
    return <Empty text="No accommodations are available right now." />;
  }

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

// ADMIN BOOKINGS
function AdminBookings({
  bookings,
  onUpdate,
  onCheckIn,
  onCheckOut,
}: {
  bookings: Booking[];
  onUpdate: (id: string, status: "CONFIRMED" | "REJECTED") => void;
  onCheckIn: (id: string) => void;
  onCheckOut: (id: string) => void;
}) {
  if (!bookings.length) {
    return <Empty text="No reservations to review." />;
  }

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

          <Text style={s.meta}>
            {new Date(b.start_at).toLocaleString()} –{" "}
            {new Date(b.end_at).toLocaleString()}
          </Text>

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
          {b.status === "CONFIRMED" && (
            <View style={{ marginTop: 12 }}>
              <Button
                title="Check In Customer"
                onPress={() => onCheckIn(b.id)}
              />
            </View>
          )}

          {b.status === "CHECKED_IN" && (
            <View style={{ marginTop: 12 }}>
              <Button
                title="Check Out Customer"
                onPress={() => onCheckOut(b.id)}
              />
            </View>
          )}

          {b.status === "COMPLETED" && (
            <Text style={[s.meta, { fontWeight: "800" }]}>
              ✓ Customer checked out · Accommodation released
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
// STATUS BADGE
function StatusPill({ status }: { status: string }) {
  const color =
    status === "CONFIRMED" || status === "COMPLETED"
      ? C.green
      : status === "REJECTED" || status === "CANCELLED"
        ? C.red
        : C.orange;

  return (
    <View style={[s.pill, { backgroundColor: `${color}18` }]}>
      <Text
        style={{
          color,
          fontWeight: "800",
          fontSize: 10,
        }}
      >
        {status}
      </Text>
    </View>
  );
}

// EMPTY STATE
function Empty({ text }: { text: string }) {
  return (
    <View style={s.empty}>
      <Text style={{ fontSize: 28 }}>🌊</Text>
      <Text style={s.meta}>{text}</Text>
    </View>
  );
}

// STYLES
const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.sand,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.sand,
    gap: 12,
  },

  authWrap: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },

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

  label: {
    fontSize: 12,
    fontWeight: "800",
    color: C.navy,
    marginBottom: 7,
  },

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

  buttonText: {
    color: C.white,
    fontWeight: "900",
    fontSize: 14,
  },

  link: {
    color: C.ocean,
    fontWeight: "800",
    fontSize: 13,
  },

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

  topBrand: {
    fontSize: 18,
    fontWeight: "900",
    color: C.navy,
  },

  topCaption: {
    fontSize: 11,
    color: C.muted,
    marginTop: 2,
  },

  avatar: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "#D9F0EA",
    alignItems: "center",
    justifyContent: "center",
  },

  content: {
    padding: 18,
    paddingBottom: 32,
  },

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

  heroPillText: {
    color: C.navy,
    fontWeight: "900",
    fontSize: 12,
  },

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

  quickText: {
    fontSize: 12,
    color: C.navy,
    fontWeight: "800",
    marginTop: 12,
  },

  listCard: {
    backgroundColor: C.white,
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 14,
  },

  cardImage: {
    height: 150,
    width: "100%",
    backgroundColor: "#DDEAE6",
  },

  category: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
    color: C.teal,
  },

  cardTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: C.navy,
    marginTop: 5,
  },

  meta: {
    fontSize: 11,
    color: C.muted,
    lineHeight: 17,
    marginTop: 5,
  },

  price: {
    fontSize: 17,
    fontWeight: "900",
    color: C.ocean,
    marginTop: 10,
  },

  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
  },

  bookingCard: {
    backgroundColor: C.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },

  pill: {
    borderRadius: 30,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },

  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 24,
  },

  stat: {
    width: "48%",
    backgroundColor: C.white,
    borderRadius: 18,
    padding: 15,
  },

  statValue: {
    fontSize: 23,
    fontWeight: "900",
    color: C.ocean,
  },

  statLabel: {
    fontSize: 11,
    color: C.muted,
    marginTop: 4,
  },

  nav: {
    height: 66,
    backgroundColor: C.white,
    borderTopWidth: 1,
    borderTopColor: C.line,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },

  navItem: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },

  navIcon: {
    fontSize: 19,
    color: "#8DA3A0",
  },

  navText: {
    fontSize: 9,
    color: C.muted,
    marginTop: 3,
  },

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

  close: {
    color: C.ocean,
    fontWeight: "900",
    marginBottom: 15,
  },

  toggleRow: {
    flexDirection: "row",
    backgroundColor: "#E5EEEA",
    padding: 4,
    borderRadius: 14,
    marginTop: 14,
  },

  toggle: {
    flex: 1,
    padding: 12,
    alignItems: "center",
    borderRadius: 11,
  },

  toggleActive: {
    backgroundColor: C.ocean,
  },

  toggleText: {
    fontWeight: "800",
    fontSize: 12,
    color: C.navy,
  },
});
const analyticsStyles = StyleSheet.create({
  track: {
    height: 10,
    backgroundColor: "#E5EEEA",
    borderRadius: 10,
    overflow: "hidden",
    marginTop: 7,
  },
  bar: {
    height: "100%",
    backgroundColor: C.teal,
    borderRadius: 10,
  },
});
