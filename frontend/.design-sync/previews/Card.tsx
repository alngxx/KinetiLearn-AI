import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "kinetilearn-frontend"

export function WithHeaderAndFooter() {
  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>Security awareness 2026</CardTitle>
        <CardDescription>Annual refresher for all staff</CardDescription>
        <CardAction>
          <Badge variant="success">Published</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">
          132 learners enrolled · 18 questions · pass mark 70%
        </p>
      </CardContent>
      <CardFooter className="border-t py-3">
        <Button variant="outline" size="sm">
          View report
        </Button>
      </CardFooter>
    </Card>
  )
}

export function Simple() {
  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>Daily quiz</CardTitle>
        <CardDescription>Five questions, refreshed each morning</CardDescription>
      </CardHeader>
    </Card>
  )
}

export function SmallSize() {
  return (
    <Card size="sm" className="max-w-xs">
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-2xl">248</p>
      </CardContent>
    </Card>
  )
}
